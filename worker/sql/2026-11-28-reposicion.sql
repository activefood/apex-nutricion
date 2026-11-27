-- Reposición (2026-11-28): relacionar el correo del newsletter con el pedido de cada cliente y poder mandarle "ya tenemos tu reposición hecha" con su carrito armado.
-- Proyecto Supabase "Active Food" (ngbrcbweduazaoidavza). Aditivo: 3 columnas en marketing.newsletter, 2 tablas nuevas y 5 funciones. No cambia ni borra pedidos.
-- Cómo se relaciona (sin adivinar nada): al comprar, el sitio manda (a) la clave del suscriptor, si ese navegador se suscribió, o (b) el correo que el cliente escribió en el
-- carrito con la casilla de aceptar correos. Con eso el suscriptor queda ligado a ESE pedido (no por teléfono: el teléfono del equipo está en pedidos de muchos clientes).
-- Cada pedido nuevo guarda además el carrito base (productos y cantidades) para poder rearmarlo. Los pedidos anteriores a hoy no lo tienen.
-- Seguridad: igual que el resto de `marketing`/`tienda`: RLS activo, sin permisos para anon/authenticated; solo se llega con las funciones (token del Worker).

alter table marketing.newsletter add column if not exists ultimo_pedido_oc text;
alter table marketing.newsletter add column if not exists nombre text;
alter table marketing.newsletter add column if not exists vinculado_en timestamptz;

create table if not exists tienda.pedido_extra (
  oc text primary key,
  correo text,                                  -- correo escrito en el carrito (opcional)
  acepta_correos boolean not null default false,
  clave text,                                   -- clave del suscriptor, si el navegador estaba suscrito
  carrito jsonb,                                -- carrito base (productos y cantidades) tal como estaba al comprar
  creado_en timestamptz not null default now()
);
alter table tienda.pedido_extra enable row level security;
revoke all on tienda.pedido_extra from anon, authenticated;

create table if not exists marketing.reposicion_enlaces (
  token text primary key default replace(gen_random_uuid()::text, '-', ''),
  email text not null,
  oc text not null,
  canal text not null default 'correo',
  creado_en timestamptz not null default now(),
  expira_en timestamptz not null default now() + interval '45 days',
  abierto_en timestamptz
);
create index if not exists reposicion_enlaces_email on marketing.reposicion_enlaces (email, creado_en desc);
alter table marketing.reposicion_enlaces enable row level security;
revoke all on marketing.reposicion_enlaces from anon, authenticated;

-- Guardar lo extra de un pedido recién creado y ligarlo al suscriptor. Solo vale para pedidos de los últimos 30 minutos.
create or replace function public.tienda_guardar_extra(p_token text, p_oc text, p_correo text, p_acepta boolean, p_clave text, p_carrito jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare p tienda.pedidos%rowtype; v_email text := lower(btrim(coalesce(p_correo, ''))); v_clave text; v_vinc boolean := false; n int;
begin
  if not tienda.token_valido(p_token) then raise exception 'no autorizado'; end if;
  if p_oc is null or p_oc !~ '^[0-9]{1,8}$' then return jsonb_build_object('ok', false, 'error', 'Pedido inválido'); end if;
  select * into p from tienda.pedidos where oc = lpad(p_oc::bigint::text, 5, '0') and origen = 'web' and creado_en > now() - interval '30 minutes';
  if not found then return jsonb_build_object('ok', false, 'error', 'Pedido no encontrado'); end if;
  if length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' then v_email := null; end if;
  v_clave := case when p_clave ~ '^[0-9a-f]{32}$' then p_clave else null end;
  insert into tienda.pedido_extra (oc, correo, acepta_correos, clave, carrito)
  values (p.oc, v_email, coalesce(p_acepta, false) and v_email is not null, v_clave,
          case when p_carrito is not null and jsonb_typeof(p_carrito) = 'array' and jsonb_array_length(p_carrito) between 1 and 40 then p_carrito else null end)
  on conflict (oc) do nothing;
  if v_clave is not null then
    update marketing.newsletter set ultimo_pedido_oc = p.oc, nombre = left(p.cliente, 100), vinculado_en = now() where clave = v_clave and baja_en is null;
    get diagnostics n = row_count; v_vinc := n > 0;
  end if;
  if not v_vinc and v_email is not null and coalesce(p_acepta, false) then
    -- el cliente aceptó recibir correos al comprar: queda como suscriptor (y si antes se había dado de baja, esto es un nuevo consentimiento)
    insert into marketing.newsletter (email, origen, ultimo_pedido_oc, nombre, vinculado_en) values (v_email, 'compra', p.oc, left(p.cliente, 100), now())
    on conflict (email) do update set ultimo_pedido_oc = excluded.ultimo_pedido_oc, nombre = excluded.nombre, vinculado_en = now(), baja_en = null;
    v_vinc := true;
  end if;
  return jsonb_build_object('ok', true, 'vinculado', v_vinc);
end $function$;

-- A quién se le puede mandar "tu reposición": suscriptores activos ligados a un pedido CONFIRMADO que tiene su carrito guardado, a los que no se les mandó
-- una reposición en los últimos 14 días.
create or replace function public.reposicion_candidatos(p_token text, p_limite integer default 100)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
begin
  if not tienda.token_valido(p_token) then raise exception 'no autorizado'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('email', n.email, 'clave', n.clave, 'nombre', n.nombre, 'oc', n.ultimo_pedido_oc,
             'items', (select coalesce(jsonb_agg(jsonb_build_object('name', x->>'name', 'quantity', x->'quantity')), '[]'::jsonb) from jsonb_array_elements(e.carrito) x)) order by n.email)
    from marketing.newsletter n
    join tienda.pedidos p on p.oc = n.ultimo_pedido_oc and p.origen = 'web' and p.estado = 'Completed'
    join tienda.pedido_extra e on e.oc = p.oc and e.carrito is not null
    where n.baja_en is null and n.ultimo_pedido_oc is not null
      and not exists (select 1 from marketing.reposicion_enlaces r where r.email = n.email and r.canal = 'correo' and r.creado_en > now() - interval '14 days')
    limit least(greatest(coalesce(p_limite, 100), 1), 500)), '[]'::jsonb);
end $function$;

-- Crear el enlace personal del correo (vale 45 días).
create or replace function public.reposicion_crear_enlace(p_token text, p_email text, p_oc text, p_canal text default 'correo')
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare v_t text;
begin
  if not tienda.token_valido(p_token) then raise exception 'no autorizado'; end if;
  if not exists (select 1 from tienda.pedidos where oc = p_oc and origen = 'web') then return jsonb_build_object('ok', false, 'error', 'Pedido no encontrado'); end if;
  insert into marketing.reposicion_enlaces (email, oc, canal) values (lower(btrim(p_email)), p_oc, left(coalesce(p_canal, 'correo'), 20)) returning token into v_t;
  return jsonb_build_object('ok', true, 'enlace', v_t);
end $function$;

-- Al abrir el enlace: devuelve el carrito guardado y los datos de entrega de ese pedido (el navegador los pone en el carrito y en el formulario, editables).
create or replace function public.reposicion_leer(p_token text, p_enlace text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare r marketing.reposicion_enlaces%rowtype; p tienda.pedidos%rowtype; e tienda.pedido_extra%rowtype;
begin
  if not tienda.token_valido(p_token) then raise exception 'no autorizado'; end if;
  if p_enlace is null or p_enlace !~ '^[0-9a-f]{32}$' then return jsonb_build_object('ok', false, 'error', 'Enlace no válido'); end if;
  select * into r from marketing.reposicion_enlaces where token = p_enlace;
  if not found or r.expira_en < now() then return jsonb_build_object('ok', false, 'error', 'Enlace vencido o no válido'); end if;
  select * into p from tienda.pedidos where oc = r.oc and origen = 'web';
  select * into e from tienda.pedido_extra where oc = r.oc;
  if p.id is null or e.carrito is null then return jsonb_build_object('ok', false, 'error', 'No hay un pedido anterior guardado'); end if;
  update marketing.reposicion_enlaces set abierto_en = coalesce(abierto_en, now()) where token = p_enlace;
  return jsonb_build_object('ok', true, 'carrito', e.carrito,
    'cliente', jsonb_build_object('nombre', p.cliente, 'telefono', p.telefono, 'estado', coalesce(p.estado_geo, ''), 'zona', coalesce(p.zona, ''), 'ci', coalesce(p.ci, ''), 'agencia', coalesce(p.agencia_mrw, '')));
end $function$;

-- Cifras para el panel de Marketing.
create or replace function public.reposicion_estado(p_token text)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
begin
  if not tienda.token_valido(p_token) then raise exception 'no autorizado'; end if;
  return jsonb_build_object(
    'ligados', (select count(*) from marketing.newsletter where baja_en is null and ultimo_pedido_oc is not null),
    'con_carrito', (select count(*) from marketing.newsletter n join tienda.pedido_extra e on e.oc = n.ultimo_pedido_oc where n.baja_en is null and e.carrito is not null),
    'enviados_30d', (select count(*) from marketing.reposicion_enlaces where canal = 'correo' and creado_en > now() - interval '30 days'),
    'abiertos_30d', (select count(*) from marketing.reposicion_enlaces where canal = 'correo' and creado_en > now() - interval '30 days' and abierto_en is not null));
end $function$;
