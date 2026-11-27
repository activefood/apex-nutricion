-- Dashboard de Ventas (2026-11-27): agrega "unidades vendidas" por día, para la gráfica mensual del Histórico (pedidos, ventas, ticket promedio y unidades por mes).
-- Proyecto Supabase "Active Food" (ngbrcbweduazaoidavza). Solo reemplaza la función tienda_dashboard_ventas: es la misma de antes más el campo 'unidades' en cada día.
-- No cambia tablas ni datos; solo lee.

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

  select coalesce(jsonb_agg(jsonb_build_object('dia', g.dia, 'ventas', coalesce(x.ventas, 0), 'pedidos', coalesce(x.pedidos, 0), 'unidades', coalesce(x.unidades, 0)) order by g.dia), '[]'::jsonb)
    into v_dias
  from (select d::date as dia from generate_series(v_desde, p_hasta, interval '1 day') d) g
  left join (
    select (p.creado_en at time zone 'America/Caracas')::date as dia,
           round(sum(coalesce((select sum(i.precio_unit * i.cantidad) from tienda.pedido_items i where i.pedido_id = p.id), 0)), 2) as ventas,
           count(*) as pedidos,
           sum(coalesce((select sum(i.cantidad) from tienda.pedido_items i where i.pedido_id = p.id), 0))::int as unidades
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
