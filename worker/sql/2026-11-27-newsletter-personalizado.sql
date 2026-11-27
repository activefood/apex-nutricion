-- Newsletter personalizado (2026-11-27): guarda qué productos mira cada suscriptor (SOLO quien se suscribió, y lo dice el aviso del cartelito) para mandarle por correo el producto que vio.
-- Proyecto Supabase "Active Food" (ngbrcbweduazaoidavza). Aditivo: 3 columnas nuevas en marketing.newsletter, 2 tablas nuevas y 6 funciones; reemplaza newsletter_suscribir (ahora también devuelve la clave del suscriptor cuando es nuevo).
-- Privacidad: del visitante NO suscrito no se guarda nada. Del suscriptor se guarda la página que miró (ruta, nombre del producto, foto) y la hora; nada de compras ni de dinero.
-- Seguridad: igual que el resto de `marketing`: RLS activo, sin permisos para anon/authenticated; solo se llega con las funciones (token del Worker).

alter table marketing.newsletter add column if not exists clave text not null default replace(gen_random_uuid()::text, '-', '');   -- identifica al suscriptor en su navegador y en el enlace de baja (no es el correo)
alter table marketing.newsletter add column if not exists ultimo_aviso_en timestamptz;
create unique index if not exists newsletter_clave_uq on marketing.newsletter (clave);

create table if not exists marketing.newsletter_vistas (
  id bigint generated always as identity primary key,
  email text not null references marketing.newsletter (email) on delete cascade,
  ruta text not null,                 -- ej. /producto-going-hidratante.html?pack=24
  titulo text,                        -- nombre del producto o de la sección, tal como se ve en la página
  imagen text,                        -- foto del producto (dirección https del propio sitio)
  visto_en timestamptz not null default now(),
  enviado_en timestamptz              -- cuándo se le avisó por correo de esta vista (vacío = pendiente)
);
create index if not exists newsletter_vistas_email on marketing.newsletter_vistas (email, visto_en desc);
alter table marketing.newsletter_vistas enable row level security;
revoke all on marketing.newsletter_vistas from anon, authenticated;

create table if not exists marketing.newsletter_envios (
  id bigint generated always as identity primary key,
  email text not null,
  ruta text,
  tipo text not null default 'producto-visto',
  estado text not null,               -- enviado | error | prueba
  detalle text,
  enviado_en timestamptz not null default now()
);
alter table marketing.newsletter_envios enable row level security;
revoke all on marketing.newsletter_envios from anon, authenticated;

-- Suscribirse (reemplaza la versión anterior). Si es nueva, devuelve la clave para que el navegador la recuerde; si ya existía, no (así nadie sacó la clave de otro con solo escribir su correo).
create or replace function public.newsletter_suscribir(p_token text, p_email text, p_origen text default 'inicio')
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare v_email text := lower(btrim(coalesce(p_email, ''))); v_nueva boolean; v_clave text;
begin
  if not tienda.token_valido(p_token) then raise exception 'no autorizado'; end if;
  if length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' then return jsonb_build_object('ok', false, 'error', 'Correo inválido'); end if;
  insert into marketing.newsletter (email, origen) values (v_email, left(coalesce(nullif(btrim(p_origen), ''), 'inicio'), 40))
  on conflict (email) do update set baja_en = null
  returning (xmax = 0), clave into v_nueva, v_clave;
  return jsonb_build_object('ok', true, 'nueva', v_nueva, 'clave', case when v_nueva then v_clave else null end);
end $function$;

-- Registrar una página que miró un suscriptor (se ignora si ya la miró en las últimas 6 horas, o si pidió la baja).
create or replace function public.newsletter_registrar_vista(p_token text, p_clave text, p_ruta text, p_titulo text, p_imagen text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare v_email text;
begin
  if not tienda.token_valido(p_token) then raise exception 'no autorizado'; end if;
  if p_clave is null or p_clave !~ '^[0-9a-f]{32}$' then return jsonb_build_object('ok', false); end if;
  if p_ruta is null or p_ruta !~ '^/[A-Za-z0-9._~%/?=&:+-]{0,200}$' then return jsonb_build_object('ok', false); end if;
  select email into v_email from marketing.newsletter where clave = p_clave and baja_en is null;
  if v_email is null then return jsonb_build_object('ok', false); end if;
  if not exists (select 1 from marketing.newsletter_vistas where email = v_email and ruta = p_ruta and visto_en > now() - interval '6 hours') then
    insert into marketing.newsletter_vistas (email, ruta, titulo, imagen)
    values (v_email, p_ruta, left(nullif(btrim(coalesce(p_titulo, '')), ''), 160), case when p_imagen ~ '^https://apexnutricionve\.com/[A-Za-z0-9._~%/-]{1,200}(\?[A-Za-z0-9=&._-]{0,40})?$' then p_imagen else null end);
  end if;
  delete from marketing.newsletter_vistas where visto_en < now() - interval '90 days';
  return jsonb_build_object('ok', true);
end $function$;

-- Darse de baja con la clave (enlace de cada correo).
create or replace function public.newsletter_baja(p_token text, p_clave text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare n int;
begin
  if not tienda.token_valido(p_token) then raise exception 'no autorizado'; end if;
  if p_clave is null or p_clave !~ '^[0-9a-f]{32}$' then return jsonb_build_object('ok', false); end if;
  update marketing.newsletter set baja_en = coalesce(baja_en, now()) where clave = p_clave;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0);
end $function$;

-- A quién avisarle hoy: suscriptores activos con vistas pendientes de las últimas 72 horas (y al menos 2 horas atrás, para que termine de navegar),
-- a los que no se les escribió en los últimos 7 días. Devuelve por cada uno sus productos más vistos.
create or replace function public.newsletter_candidatos(p_token text, p_limite integer default 40)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
begin
  if not tienda.token_valido(p_token) then raise exception 'no autorizado'; end if;
  return coalesce((
    select jsonb_agg(x.o) from (
      select jsonb_build_object('email', n.email, 'clave', n.clave, 'vistas', (
        select jsonb_agg(jsonb_build_object('ruta', v.ruta, 'titulo', v.titulo, 'imagen', v.imagen, 'veces', v.veces, 'ultima', v.ultima) order by v.veces desc, v.ultima desc)
        from (select ruta, max(titulo) as titulo, max(imagen) as imagen, count(*) as veces, max(visto_en) as ultima
              from marketing.newsletter_vistas where email = n.email and enviado_en is null and visto_en > now() - interval '72 hours' and visto_en < now() - interval '2 hours'
              group by ruta order by count(*) desc, max(visto_en) desc limit 5) v)) as o
      from marketing.newsletter n
      where n.baja_en is null and (n.ultimo_aviso_en is null or n.ultimo_aviso_en < now() - interval '7 days')
        and exists (select 1 from marketing.newsletter_vistas w where w.email = n.email and w.enviado_en is null and w.visto_en > now() - interval '72 hours' and w.visto_en < now() - interval '2 hours')
      order by n.email limit least(greatest(coalesce(p_limite, 40), 1), 200)) x), '[]'::jsonb);
end $function$;

-- Anotar que ya se le avisó (marca sus vistas pendientes y la fecha del último aviso) y dejar el registro del envío.
create or replace function public.newsletter_marcar_envio(p_token text, p_email text, p_ruta text, p_estado text, p_detalle text, p_tipo text default 'producto-visto')
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not tienda.token_valido(p_token) then raise exception 'no autorizado'; end if;
  insert into marketing.newsletter_envios (email, ruta, tipo, estado, detalle) values (lower(btrim(p_email)), left(p_ruta, 200), left(coalesce(p_tipo, 'producto-visto'), 30), left(coalesce(p_estado, ''), 20), left(coalesce(p_detalle, ''), 300));
  if p_estado = 'enviado' and coalesce(p_tipo, 'producto-visto') = 'producto-visto' then
    update marketing.newsletter set ultimo_aviso_en = now() where email = lower(btrim(p_email));
    update marketing.newsletter_vistas set enviado_en = now() where email = lower(btrim(p_email)) and enviado_en is null;
  end if;
  delete from marketing.newsletter_envios where enviado_en < now() - interval '400 days';
  return jsonb_build_object('ok', true);
end $function$;

-- Resumen para el panel de Marketing (solo cantidades; no muestra correos).
create or replace function public.newsletter_resumen(p_token text, p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare v jsonb;
begin
  if not tienda.token_valido(p_token) then raise exception 'no autorizado'; end if;
  select jsonb_build_object(
    'activos', (select count(*) from marketing.newsletter where baja_en is null),
    'bajas', (select count(*) from marketing.newsletter where baja_en is not null),
    'nuevos', (select count(*) from marketing.newsletter where (creado_en at time zone 'America/Caracas')::date between p_desde and p_hasta),
    'con_vistas', (select count(distinct email) from marketing.newsletter_vistas where (visto_en at time zone 'America/Caracas')::date between p_desde and p_hasta),
    'vistas', (select count(*) from marketing.newsletter_vistas where (visto_en at time zone 'America/Caracas')::date between p_desde and p_hasta),
    'avisos', (select count(*) from marketing.newsletter_envios where estado = 'enviado' and tipo = 'producto-visto' and (enviado_en at time zone 'America/Caracas')::date between p_desde and p_hasta),
    'top', coalesce((select jsonb_agg(to_jsonb(t) order by t.vistas desc) from (
        select ruta, max(titulo) as titulo, count(*)::int as vistas, count(distinct email)::int as suscriptores
        from marketing.newsletter_vistas where (visto_en at time zone 'America/Caracas')::date between p_desde and p_hasta group by ruta order by count(*) desc limit 8) t), '[]'::jsonb),
    'ultimo_aviso', (select max(enviado_en) from marketing.newsletter_envios where estado = 'enviado' and tipo = 'producto-visto')
  ) into v;
  return v;
end $function$;
