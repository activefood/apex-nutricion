-- Newsletter de Apex (2026-11-27): guarda los correos de quien se suscribe desde la página de inicio.
-- Proyecto Supabase "Active Food" (ngbrcbweduazaoidavza). Aditivo: 1 tabla en el esquema `marketing` y 1 función. No toca nada existente.
-- Solo se guarda el correo (en minúsculas, sin repetidos), cuándo se suscribió y desde dónde. Una persona que se vuelve a suscribir se reactiva.
-- Seguridad: igual que el resto de `marketing`: RLS activo, sin permisos para anon/authenticated; solo se llega con la función (token del Worker).

create table if not exists marketing.newsletter (
  email text primary key,
  creado_en timestamptz not null default now(),
  origen text not null default 'inicio',
  baja_en timestamptz              -- fecha en que pidió darse de baja (vacío = activo)
);
alter table marketing.newsletter enable row level security;
revoke all on marketing.newsletter from anon, authenticated;

create or replace function public.newsletter_suscribir(p_token text, p_email text, p_origen text default 'inicio')
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare v_email text := lower(btrim(coalesce(p_email, ''))); v_nueva boolean;
begin
  if not tienda.token_valido(p_token) then raise exception 'no autorizado'; end if;
  if length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' then return jsonb_build_object('ok', false, 'error', 'Correo inválido'); end if;
  insert into marketing.newsletter (email, origen) values (v_email, left(coalesce(nullif(btrim(p_origen), ''), 'inicio'), 40))
  on conflict (email) do update set baja_en = null
  returning (xmax = 0) into v_nueva;
  return jsonb_build_object('ok', true, 'nueva', v_nueva);
end $function$;
