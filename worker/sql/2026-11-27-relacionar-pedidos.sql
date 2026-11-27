-- Relacionar pedidos cancelados con otros pedidos del mismo cliente (2026-11-27).
-- Problema: un cliente cancela (o repite) un pedido y hace otro enseguida; con pocos pedidos se ve a ojo, con más no. Esto lo deja guardado y automático.
-- Proyecto Supabase "Active Food" (ngbrcbweduazaoidavza). Aditivo: 1 tabla (pedido_relacion), 4 funciones auxiliares/principales y 1 dato en tienda.config. No cambia ni borra pedidos.
--
-- Regla (probada con los pedidos reales de noviembre): para cada pedido CANCELADO se busca, en una ventana de 72 horas antes o después, el pedido de OTRO
-- cliente igual:
--   a) mismo teléfono (últimos 10 dígitos), salvo los teléfonos del equipo, que aparecen en pedidos de muchos clientes distintos; o
--   b) nombre parecido (>= 75% tras quitar tildes y espacios, tolera errores de tipeo) Y productos parecidos (>= 50% en común). Nombres de menos de 4 letras no cuentan.
-- Si hay varios, se prefiere uno NO cancelado y el más cercano en el tiempo. Queda guardado quién es y por qué regla se detectó.

-- Teléfonos del equipo (no sirven para identificar a un cliente). Se pueden agregar más separados por coma.
insert into tienda.config (clave, valor) values ('telefonos_equipo', '4141742967') on conflict (clave) do nothing;

create table if not exists tienda.pedido_relacion (
  oc_origen text not null,                 -- el pedido cancelado
  oc_relacionado text not null,            -- el otro pedido del mismo cliente
  regla text not null,                     -- 'telefono' | 'nombre y productos'
  horas numeric(8, 1) not null,            -- diferencia: negativo = el otro pedido fue ANTES, positivo = DESPUÉS
  similitud_nombre numeric(4, 2),
  parecido_productos numeric(4, 2),
  detectado_en timestamptz not null default now(),
  primary key (oc_origen, oc_relacionado)
);
alter table tienda.pedido_relacion enable row level security;
revoke all on tienda.pedido_relacion from anon, authenticated;

-- Auxiliares (sin extensiones)
create or replace function tienda.distancia_texto(a text, b text)
returns integer language plpgsql immutable set search_path to '' as $function$
declare la int := length(coalesce(a, '')); lb int := length(coalesce(b, '')); prev int[]; cur int[]; i int; j int; costo int;
begin
  if la = 0 then return lb; end if;
  if lb = 0 then return la; end if;
  prev := array(select generate_series(0, lb));
  for i in 1..la loop
    cur := array[i];
    for j in 1..lb loop
      costo := case when substr(a, i, 1) = substr(b, j, 1) then 0 else 1 end;
      cur[j + 1] := least(prev[j + 1] + 1, cur[j] + 1, prev[j] + costo);
    end loop;
    prev := cur;
  end loop;
  return prev[lb + 1];
end $function$;

create or replace function tienda.nombre_normalizado(n text)
returns text language sql immutable set search_path to '' as $function$
  select regexp_replace(lower(translate(coalesce(n, ''), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')), '[^a-z]', '', 'g')
$function$;

create or replace function tienda.telefono10(t text)
returns text language sql immutable set search_path to '' as $function$
  select right(case when regexp_replace(coalesce(t, ''), '\D', '', 'g') ~ '^58.{10,}$' then substr(regexp_replace(coalesce(t, ''), '\D', '', 'g'), 3)
                    else regexp_replace(coalesce(t, ''), '\D', '', 'g') end, 10)
$function$;

-- Productos de un pedido sin el tamaño ("— 300 g"), para comparar "Hidratante Pitaya — 300 g" con "Hidratante Pitaya".
create or replace function tienda.productos_clave(p_pedido_id bigint)
returns text[] language sql stable set search_path to '' as $function$
  select coalesce(array_agg(distinct regexp_replace(lower(i.producto), '\s*—\s*\d+\s*g\M', '')), '{}') from tienda.pedido_items i where i.pedido_id = p_pedido_id
$function$;

-- Principal: recalcula la relación de los pedidos cancelados de los últimos p_dias días. Se puede correr las veces que sea (es idempotente).
create or replace function public.tienda_relacionar_pedidos(p_token text, p_horas integer default 72, p_dias integer default 120)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare c record; mejor record; v_eval int := 0; v_rel int := 0; v_equipo text[];
begin
  if not tienda.token_valido(p_token) then raise exception 'no autorizado'; end if;
  select coalesce(string_to_array(valor, ','), '{}') into v_equipo from tienda.config where clave = 'telefonos_equipo';
  v_equipo := coalesce(v_equipo, '{}');
  for c in select p.id, p.oc, p.creado_en, p.cliente, tienda.telefono10(p.telefono) as tel, tienda.nombre_normalizado(p.cliente) as nom, tienda.productos_clave(p.id) as prods
           from tienda.pedidos p where p.origen = 'web' and p.estado = 'Canceled' and p.creado_en > now() - make_interval(days => least(greatest(coalesce(p_dias, 120), 1), 400)) loop
    v_eval := v_eval + 1;
    select o.oc, o.estado, round((extract(epoch from (o.creado_en - c.creado_en)) / 3600)::numeric, 1) as horas,
           x.sim, x.jac, x.mismo_tel
      into mejor
      from tienda.pedidos o
      cross join lateral (
        select case when greatest(length(c.nom), length(tienda.nombre_normalizado(o.cliente))) = 0 then 0
                    else 1 - tienda.distancia_texto(c.nom, tienda.nombre_normalizado(o.cliente))::numeric / greatest(length(c.nom), length(tienda.nombre_normalizado(o.cliente))) end as sim,
               (select case when cardinality(c.prods) + cardinality(op) = 0 then 0
                            else (select count(*) from unnest(c.prods) u where u = any (op))::numeric
                                 / nullif((select count(*) from (select unnest(c.prods) union select unnest(op)) z), 0) end
                  from (select tienda.productos_clave(o.id) as op) q) as jac,
               (c.tel <> '' and c.tel = tienda.telefono10(o.telefono) and not (c.tel = any (v_equipo))) as mismo_tel
      ) x
     where o.origen = 'web' and o.oc <> c.oc
       and abs(extract(epoch from (o.creado_en - c.creado_en)) / 3600) <= greatest(coalesce(p_horas, 72), 1)
       and (x.mismo_tel or (x.sim >= 0.75 and x.jac >= 0.5 and length(c.nom) >= 4 and length(tienda.nombre_normalizado(o.cliente)) >= 4))
     order by (o.estado <> 'Canceled') desc, abs(extract(epoch from (o.creado_en - c.creado_en))) asc
     limit 1;
    delete from tienda.pedido_relacion where oc_origen = c.oc;
    if mejor.oc is not null then
      insert into tienda.pedido_relacion (oc_origen, oc_relacionado, regla, horas, similitud_nombre, parecido_productos)
      values (c.oc, mejor.oc, case when mejor.mismo_tel then 'telefono' else 'nombre y productos' end, mejor.horas, round(mejor.sim, 2), round(mejor.jac, 2));
      v_rel := v_rel + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'evaluados', v_eval, 'relacionados', v_rel);
end $function$;
