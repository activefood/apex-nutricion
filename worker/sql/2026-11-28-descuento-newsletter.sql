-- Descuento de 10% por dejar el correo (2026-11-28). Reemplaza el descuento de primera compra (APEX2026), que se quita del sitio. No hay código.
-- Proyecto Supabase "Active Food" (ngbrcbweduazaoidavza). Aditivo: 2 columnas en marketing.newsletter, 2 funciones nuevas y 1 reemplazada (newsletter_resumen).
-- No cambia ni borra pedidos ni suscriptores. Va DESPUÉS de 2026-11-28-reposicion.sql (usa su función tienda_guardar_extra para dejar al cliente como suscriptor).
-- Cómo funciona: en el carrito, el cliente escribe su correo y marca la casilla de recibir correos (o ya se suscribió en este navegador, que manda su clave).
-- El sitio pregunta aquí si a ese correo todavía le toca el 10% (un solo pedido con descuento por correo) y lo aplica solo. Al registrarse el pedido, se marca como usado.
-- Seguridad: igual que el resto de `marketing`: RLS activo, sin permisos para anon/authenticated; solo se llega con las funciones (token del Worker).

alter table marketing.newsletter add column if not exists descuento_usado_en timestamptz;
alter table marketing.newsletter add column if not exists descuento_pedido_oc text;

-- ¿Le toca el 10% a esta persona? Se identifica por la clave del navegador (suscriptor) o por el correo. Solo lectura. Un correo que nunca ha comprado con descuento
-- (aunque aún no esté en la lista) sí puede; uno que ya lo usó, no.
create or replace function public.newsletter_descuento_disponible(p_token text, p_email text, p_clave text)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare v_email text := lower(btrim(coalesce(p_email, ''))); n marketing.newsletter%rowtype;
begin
  if not tienda.token_valido(p_token) then raise exception 'no autorizado'; end if;
  if p_clave is not null and p_clave ~ '^[0-9a-f]{32}$' then
    select * into n from marketing.newsletter where clave = p_clave and baja_en is null;
    if found then return jsonb_build_object('ok', true, 'disponible', n.descuento_usado_en is null, 'tasa', 0.10); end if;
  end if;
  if length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' then return jsonb_build_object('ok', true, 'disponible', false); end if;
  select * into n from marketing.newsletter where email = v_email;
  return jsonb_build_object('ok', true, 'disponible', not found or n.descuento_usado_en is null, 'tasa', 0.10);
end $function$;

-- Marcar el descuento como usado cuando se registra el pedido (una sola vez). Se llama después de tienda_guardar_extra, que ya dejó al cliente en la lista.
create or replace function public.newsletter_canjear_descuento(p_token text, p_email text, p_clave text, p_oc text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare v_email text := lower(btrim(coalesce(p_email, ''))); n int := 0;
begin
  if not tienda.token_valido(p_token) then raise exception 'no autorizado'; end if;
  if p_clave is not null and p_clave ~ '^[0-9a-f]{32}$' then
    update marketing.newsletter set descuento_usado_en = now(), descuento_pedido_oc = left(coalesce(p_oc, ''), 12)
     where clave = p_clave and baja_en is null and descuento_usado_en is null;
    get diagnostics n = row_count;
  end if;
  if n = 0 and v_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' then
    update marketing.newsletter set descuento_usado_en = now(), descuento_pedido_oc = left(coalesce(p_oc, ''), 12)
     where email = v_email and descuento_usado_en is null;
    get diagnostics n = row_count;
  end if;
  return jsonb_build_object('ok', n > 0);
end $function$;

-- Resumen para el panel de Marketing: igual que antes, más los descuentos de 10% usados en el periodo (por la fecha del canje).
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
    'descuentos_usados', (select count(*) from marketing.newsletter where descuento_usado_en is not null and (descuento_usado_en at time zone 'America/Caracas')::date between p_desde and p_hasta),
    'top', coalesce((select jsonb_agg(to_jsonb(t) order by t.vistas desc) from (
        select ruta, max(titulo) as titulo, count(*)::int as vistas, count(distinct email)::int as suscriptores
        from marketing.newsletter_vistas where (visto_en at time zone 'America/Caracas')::date between p_desde and p_hasta group by ruta order by count(*) desc limit 8) t), '[]'::jsonb),
    'ultimo_aviso', (select max(enviado_en) from marketing.newsletter_envios where estado = 'enviado' and tipo = 'producto-visto')
  ) into v;
  return v;
end $function$;
