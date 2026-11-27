-- Correos en los pedidos viejos + ciclo de compra (2026-11-29).
-- Proyecto Supabase "Active Food" (ngbrcbweduazaoidavza). Va DESPUÉS de 2026-11-28-reposicion.sql y 2026-11-28-descuento-newsletter.sql.
-- Aditivo: 1 columna en tienda.pedido_extra, 1 en marketing.newsletter, 2 funciones nuevas y 2 reemplazadas (tienda_guardar_extra, reposicion_estado). No cambia ni borra pedidos.
--
-- Qué hace: cuando alguien compra y deja su correo con la casilla de recibir correos (o ya es suscriptor), ese correo se pone también en SUS pedidos anteriores:
--   a) mismo teléfono (últimos 10 dígitos), salvo los teléfonos del equipo (aparecen en pedidos de muchos clientes); es una coincidencia fuerte -> origen 'telefono';
--   b) mismo nombre completo (al menos 9 letras, sin tildes ni espacios) en pedidos que no tienen teléfono (el histórico de ventas de junio a septiembre); es menos segura,
--      por eso queda marcada con origen 'nombre'.
-- Los pedidos viejos no pueden tener carrito (no se guardó); la reposición siempre arma el carrito del último pedido, que sí lo tiene. Con esto el correo sirve para ver todo el
-- historial de una persona (cuánto compra, cada cuánto) y no solo el pedido de hoy. Nunca pisa un correo que el pedido ya tenía.
-- Seguridad: igual que el resto: RLS activo, sin permisos para anon/authenticated; solo se llega con las funciones (token del Worker).

alter table tienda.pedido_extra add column if not exists correo_origen text;        -- 'pedido' (lo escribió en ese pedido) | 'telefono' | 'nombre'
alter table marketing.newsletter add column if not exists telefono10 text;            -- teléfono del cliente (últimos 10 dígitos), sale de su compra; nunca el del equipo
create index if not exists newsletter_telefono10 on marketing.newsletter (telefono10);

-- Auxiliar: pone p_email en los pedidos anteriores de la misma persona que el pedido p_oc. Devuelve cuántos pedidos viejos recibieron el correo.
create or replace function tienda.vincular_correo_pedidos(p_oc text, p_email text)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare p tienda.pedidos%rowtype; v_tel text; v_nom text; v_equipo text[]; n1 int := 0; n2 int := 0;
begin
  if p_email is null then return 0; end if;
  select * into p from tienda.pedidos where oc = p_oc;
  if not found then return 0; end if;
  select coalesce(string_to_array(valor, ','), '{}') into v_equipo from tienda.config where clave = 'telefonos_equipo';
  v_equipo := coalesce(v_equipo, '{}');
  v_tel := tienda.telefono10(p.telefono); v_nom := tienda.nombre_normalizado(p.cliente);
  if v_tel <> '' and not (v_tel = any (v_equipo)) then
    insert into tienda.pedido_extra (oc, correo, acepta_correos, correo_origen)
      select o.oc, p_email, true, 'telefono' from tienda.pedidos o where o.oc <> p.oc and tienda.telefono10(o.telefono) = v_tel
    on conflict (oc) do update set correo = excluded.correo, acepta_correos = true, correo_origen = excluded.correo_origen where tienda.pedido_extra.correo is null;
    get diagnostics n1 = row_count;
    update marketing.newsletter set telefono10 = v_tel where email = p_email and telefono10 is null;
  end if;
  if length(v_nom) >= 9 then
    insert into tienda.pedido_extra (oc, correo, acepta_correos, correo_origen)
      select o.oc, p_email, true, 'nombre' from tienda.pedidos o
       where o.oc <> p.oc and tienda.telefono10(o.telefono) = '' and tienda.nombre_normalizado(o.cliente) = v_nom
    on conflict (oc) do update set correo = excluded.correo, acepta_correos = true, correo_origen = excluded.correo_origen where tienda.pedido_extra.correo is null;
    get diagnostics n2 = row_count;
  end if;
  return n1 + n2;
end $function$;
revoke all on function tienda.vincular_correo_pedidos(text, text) from public, anon, authenticated;

-- Guardar lo extra de un pedido recién creado y ligarlo al suscriptor (igual que antes) + ahora también el correo en los pedidos viejos de esa persona.
create or replace function public.tienda_guardar_extra(p_token text, p_oc text, p_correo text, p_acepta boolean, p_clave text, p_carrito jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare p tienda.pedidos%rowtype; v_email text := lower(btrim(coalesce(p_correo, ''))); v_clave text; v_vinc boolean := false; n int; v_final text; v_viejos int := 0;
begin
  if not tienda.token_valido(p_token) then raise exception 'no autorizado'; end if;
  if p_oc is null or p_oc !~ '^[0-9]{1,8}$' then return jsonb_build_object('ok', false, 'error', 'Pedido inválido'); end if;
  select * into p from tienda.pedidos where oc = lpad(p_oc::bigint::text, 5, '0') and origen = 'web' and creado_en > now() - interval '30 minutes';
  if not found then return jsonb_build_object('ok', false, 'error', 'Pedido no encontrado'); end if;
  if length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' then v_email := null; end if;
  v_clave := case when p_clave ~ '^[0-9a-f]{32}$' then p_clave else null end;
  insert into tienda.pedido_extra (oc, correo, acepta_correos, clave, carrito, correo_origen)
  values (p.oc, v_email, coalesce(p_acepta, false) and v_email is not null, v_clave,
          case when p_carrito is not null and jsonb_typeof(p_carrito) = 'array' and jsonb_array_length(p_carrito) between 1 and 40 then p_carrito else null end,
          case when v_email is not null then 'pedido' end)
  on conflict (oc) do nothing;
  if v_clave is not null then
    update marketing.newsletter set ultimo_pedido_oc = p.oc, nombre = left(p.cliente, 100), vinculado_en = now() where clave = v_clave and baja_en is null
      returning email into v_final;
    get diagnostics n = row_count; v_vinc := n > 0;
  end if;
  if not v_vinc and v_email is not null and coalesce(p_acepta, false) then
    insert into marketing.newsletter (email, origen, ultimo_pedido_oc, nombre, vinculado_en) values (v_email, 'compra', p.oc, left(p.cliente, 100), now())
    on conflict (email) do update set ultimo_pedido_oc = excluded.ultimo_pedido_oc, nombre = excluded.nombre, vinculado_en = now(), baja_en = null;
    v_vinc := true; v_final := v_email;
  end if;
  if v_final is not null then
    -- el cliente ya consintió (suscripción o casilla): su correo queda también en este pedido (si venía por la clave) y en sus pedidos anteriores
    update tienda.pedido_extra set correo = coalesce(correo, v_final), acepta_correos = true, correo_origen = coalesce(correo_origen, 'pedido') where oc = p.oc;
    v_viejos := tienda.vincular_correo_pedidos(p.oc, v_final);
  end if;
  return jsonb_build_object('ok', true, 'vinculado', v_vinc, 'pedidos_viejos', v_viejos);
end $function$;

-- Repasar todos los correos ya consentidos y completar sus pedidos viejos (se puede correr las veces que sea; no pisa nada). Devuelve cuántos pedidos recibieron correo.
create or replace function public.tienda_vincular_correos_pedidos(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare r record; n int := 0;
begin
  if not tienda.token_valido(p_token) then raise exception 'no autorizado'; end if;
  for r in select oc, correo from tienda.pedido_extra where correo is not null and acepta_correos and correo_origen = 'pedido' loop
    n := n + tienda.vincular_correo_pedidos(r.oc, r.correo);
  end loop;
  return jsonb_build_object('ok', true, 'pedidos_actualizados', n);
end $function$;

-- Cifras para el panel de Marketing: lo de antes + pedidos con correo y el ciclo de compra (cada cuántos días vuelve a comprar un cliente).
-- Un cliente es su nombre completo (9 letras o más; une el histórico, que no tiene teléfono, con la web) o, si el nombre es corto, su teléfono (si no es del equipo). Solo cuentan pedidos confirmados y compras de días distintos.
create or replace function public.reposicion_estado(p_token text)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare v jsonb; v_equipo text[];
begin
  if not tienda.token_valido(p_token) then raise exception 'no autorizado'; end if;
  select coalesce(string_to_array(valor, ','), '{}') into v_equipo from tienda.config where clave = 'telefonos_equipo'; v_equipo := coalesce(v_equipo, '{}');
  with c as (
    select case when length(tienda.nombre_normalizado(p.cliente)) >= 9 then 'n:' || tienda.nombre_normalizado(p.cliente)
                else coalesce(nullif(case when tienda.telefono10(p.telefono) = any (v_equipo) then '' else tienda.telefono10(p.telefono) end, ''),
                              case when length(tienda.nombre_normalizado(p.cliente)) >= 4 then 'n:' || tienda.nombre_normalizado(p.cliente) end) end as k, p.creado_en
    from tienda.pedidos p where p.estado = 'Completed'),
  g as (select k, extract(epoch from (creado_en - lag(creado_en) over (partition by k order by creado_en))) / 86400 as dias from c where k is not null),
  r as (select dias from g where dias >= 1)
  select jsonb_build_object(
    'ciclo_mediana_dias', (select round((percentile_cont(0.5) within group (order by dias))::numeric, 1) from r),
    'ciclo_promedio_dias', (select round(avg(dias)::numeric, 1) from r),
    'recompras', (select count(*) from r),
    'clientes', (select count(distinct k) from c where k is not null),
    'clientes_que_repiten', (select count(*) from (select k from g where dias >= 1 group by k) x))
  into v;
  return v || jsonb_build_object(
    'ligados', (select count(*) from marketing.newsletter where baja_en is null and ultimo_pedido_oc is not null),
    'con_carrito', (select count(*) from marketing.newsletter n join tienda.pedido_extra e on e.oc = n.ultimo_pedido_oc where n.baja_en is null and e.carrito is not null),
    'pedidos_con_correo', (select count(*) from tienda.pedido_extra where correo is not null and acepta_correos),
    'enviados_30d', (select count(*) from marketing.reposicion_enlaces where canal = 'correo' and creado_en > now() - interval '30 days'),
    'abiertos_30d', (select count(*) from marketing.reposicion_enlaces where canal = 'correo' and creado_en > now() - interval '30 days' and abierto_en is not null));
end $function$;
