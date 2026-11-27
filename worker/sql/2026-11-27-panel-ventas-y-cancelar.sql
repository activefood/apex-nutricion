-- Panel de pedidos (2026-11-27):
--   1) tienda_dashboard_ventas: datos para el tablero de ventas (totales, por día, por producto y marca, y comparación con otro periodo).
--   2) tienda_panel_accion: ahora también deja cancelar un pedido YA confirmado (antes solo los sin confirmar). Si esa venta ya se había
--      enviado a GA4, devuelve los datos para que el Worker mande el evento "refund" (reembolso) y GA4 no cuente la venta.
-- Proyecto Supabase "Active Food" (ngbrcbweduazaoidavza). No borra nada: cancelar solo cambia el estado a 'Canceled'.

create or replace function public.tienda_dashboard_ventas(p_token text, p_desde date, p_hasta date, p_cdesde date default null, p_chasta date default null)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  v_desde date; v_actual jsonb; v_comp jsonb; v_dias jsonb; v_prods jsonb; v_marcas jsonb;
begin
  if not tienda.token_valido(p_token) then raise exception 'no autorizado'; end if;
  v_desde := coalesce(p_desde, (select min((p.creado_en at time zone 'America/Caracas')::date) from tienda.pedidos p where p.estado = 'Completed'), p_hasta);
  if p_hasta is null or p_hasta < v_desde or p_hasta - v_desde > 4000 then
    return jsonb_build_object('ok', false, 'error', 'Fechas inválidas');
  end if;

  with ped as (
    select p.id, (p.creado_en at time zone 'America/Caracas')::date as dia,
           coalesce((select sum(i.precio_unit * i.cantidad) from tienda.pedido_items i where i.pedido_id = p.id), 0) as total
    from tienda.pedidos p
    where p.estado = 'Completed' and (p.creado_en at time zone 'America/Caracas')::date between v_desde and p_hasta)
  select jsonb_build_object('desde', v_desde, 'hasta', p_hasta, 'pedidos', count(*), 'ventas', coalesce(round(sum(total), 2), 0))
    into v_actual from ped;

  if p_cdesde is not null and p_chasta is not null and p_chasta >= p_cdesde then
    with ped as (
      select coalesce((select sum(i.precio_unit * i.cantidad) from tienda.pedido_items i where i.pedido_id = p.id), 0) as total
      from tienda.pedidos p
      where p.estado = 'Completed' and (p.creado_en at time zone 'America/Caracas')::date between p_cdesde and p_chasta)
    select jsonb_build_object('desde', p_cdesde, 'hasta', p_chasta, 'pedidos', count(*), 'ventas', coalesce(round(sum(total), 2), 0))
      into v_comp from ped;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('dia', g.dia, 'ventas', coalesce(x.ventas, 0), 'pedidos', coalesce(x.pedidos, 0)) order by g.dia), '[]'::jsonb)
    into v_dias
  from (select d::date as dia from generate_series(v_desde, p_hasta, interval '1 day') d) g
  left join (
    select (p.creado_en at time zone 'America/Caracas')::date as dia, round(sum(coalesce((select sum(i.precio_unit * i.cantidad) from tienda.pedido_items i where i.pedido_id = p.id), 0)), 2) as ventas, count(*) as pedidos
    from tienda.pedidos p
    where p.estado = 'Completed' and (p.creado_en at time zone 'America/Caracas')::date between v_desde and p_hasta
    group by 1) x on x.dia = g.dia;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.ventas desc), '[]'::jsonb) into v_prods from (
    select i.producto, coalesce(nullif(i.marca, ''), 'Sin marca') as marca, sum(i.cantidad)::int as unidades, round(sum(i.precio_unit * i.cantidad), 2) as ventas
    from tienda.pedidos p join tienda.pedido_items i on i.pedido_id = p.id
    where p.estado = 'Completed' and (p.creado_en at time zone 'America/Caracas')::date between v_desde and p_hasta
    group by 1, 2 order by ventas desc limit 60) r;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.ventas desc), '[]'::jsonb) into v_marcas from (
    select coalesce(nullif(i.marca, ''), 'Sin marca') as marca, sum(i.cantidad)::int as unidades, round(sum(i.precio_unit * i.cantidad), 2) as ventas
    from tienda.pedidos p join tienda.pedido_items i on i.pedido_id = p.id
    where p.estado = 'Completed' and (p.creado_en at time zone 'America/Caracas')::date between v_desde and p_hasta
    group by 1 order by ventas desc) r;

  return jsonb_build_object('ok', true, 'actual', v_actual, 'comparacion', v_comp, 'dias', v_dias, 'productos', v_prods, 'marcas', v_marcas,
                            'generado', (extract(epoch from now()) * 1000)::bigint);
end $function$;

create or replace function public.tienda_panel_accion(p_token text, p_oc text, p_accion text, p_valor text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare p tienda.pedidos%rowtype; v_oc text; v_total numeric; v_val text;
begin
  if not tienda.token_valido(p_token) then raise exception 'no autorizado'; end if;
  if p_accion is null or p_accion not in ('completed', 'canceled', 'pickup', 'delivery', 'delivery_price') then return jsonb_build_object('ok', false, 'error', 'Acción no permitida'); end if;
  if p_oc is null or p_oc !~ '^[0-9]{1,8}$' then return jsonb_build_object('ok', false, 'error', 'Número de pedido inválido'); end if;
  v_oc := lpad(p_oc::bigint::text, 5, '0');
  select * into p from tienda.pedidos where oc = v_oc and origen = 'web' for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'Pedido no encontrado: ' || p_oc); end if;
  if p.estado = 'Canceled' then return jsonb_build_object('ok', p_accion = 'canceled', 'error', case when p_accion = 'canceled' then null else 'El pedido está cancelado.' end); end if;
  if p_accion = 'canceled' then
    if p.estado = 'Completed' then
      -- Cancelar un pedido ya confirmado: deja de contar como venta. Si ya se mandó a GA4, se devuelven los datos del reembolso.
      select coalesce(round(sum(precio_unit * cantidad), 2), 0) into v_total from tienda.pedido_items where pedido_id = p.id;
      update tienda.pedidos set estado = 'Canceled', cancelado_en = now() where id = p.id;
      return jsonb_build_object('ok', true, 'estaba_confirmado', true,
        'reembolso', case when p.ga4_enviado_en is not null
          then jsonb_build_object('oc', p.oc, 'total', v_total, 'clientId', p.ga_client_id, 'telefono', p.telefono, 'cliente', p.cliente)
          else null end);
    end if;
    update tienda.pedidos set estado = 'Canceled', cancelado_en = now() where id = p.id;
    return jsonb_build_object('ok', true);
  elsif p_accion = 'completed' then
    if p.estado = 'Pending' then update tienda.pedidos set estado = 'Completed', confirmado_en = coalesce(confirmado_en, now()) where id = p.id; end if;
    return jsonb_build_object('ok', true, 'enviar_ga4', p.ga4_enviado_en is null);
  end if;
  if p.estado <> 'Completed' then return jsonb_build_object('ok', false, 'error', 'Primero hay que confirmar el pedido.'); end if;
  if p_accion = 'pickup' then
    if p.entrega is null and p.entrega_paga is null then update tienda.pedidos set entrega = 'Pickup' where id = p.id; end if;
  elsif p_accion = 'delivery' then
    if p.entrega is null and p.entrega_paga is null then
      select coalesce(sum(precio_unit * cantidad), 0) into v_total from tienda.pedido_items where pedido_id = p.id;
      update tienda.pedidos set entrega_paga = case when v_total >= 30 then 'Tienda' else 'Cliente' end where id = p.id;   -- envío gratis desde $30
    end if;
  elsif p_accion = 'delivery_price' then
    if p.entrega is null then
      v_val := tienda.normalizar_entrega(p_valor);
      if v_val is null then return jsonb_build_object('ok', false, 'error', 'Invalid delivery value: ' || coalesce(p_valor, '')); end if;
      update tienda.pedidos set entrega = v_val where id = p.id;
    end if;
  end if;
  return jsonb_build_object('ok', true);
end $function$;
