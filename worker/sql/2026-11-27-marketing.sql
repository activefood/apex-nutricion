-- Panel de marketing (2026-11-27): esquema `marketing` con los datos de Google Analytics (GA4) traídos por Windsor.
-- Proyecto Supabase "Active Food" (ngbrcbweduazaoidavza). Aditivo: crea un esquema nuevo, sus tablas y 3 funciones. No toca `tienda` ni `public.*` existentes.
-- REGLA: aquí NO se guarda dinero ni ventas (nada de compras, ingresos ni transacciones de GA4): solo tráfico y el embudo hasta "inicia compra".
-- Seguridad: tablas con RLS activo y sin permisos para anon/authenticated; solo se alcanzan con las funciones de abajo, que exigen el token del Worker.

create schema if not exists marketing;
revoke all on schema marketing from anon, authenticated;

create table if not exists marketing.ga4_dia (
  dia date primary key,
  sesiones integer not null default 0,
  usuarios integer not null default 0,
  nuevos integer not null default 0,
  paginas_vistas integer not null default 0,
  sesiones_activas integer not null default 0,
  duracion_prom numeric(10, 2) not null default 0,   -- segundos por sesión
  add_carrito integer not null default 0,
  inicia_compra integer not null default 0,
  actualizado timestamptz not null default now()
);
create table if not exists marketing.ga4_fuente (
  dia date not null, fuente text not null, medio text not null,
  sesiones integer not null default 0, usuarios integer not null default 0,
  actualizado timestamptz not null default now(),
  primary key (dia, fuente, medio)
);
create table if not exists marketing.ga4_dispositivo (
  dia date not null, dispositivo text not null,
  sesiones integer not null default 0, usuarios integer not null default 0,
  actualizado timestamptz not null default now(),
  primary key (dia, dispositivo)
);
create table if not exists marketing.ga4_pagina (
  dia date not null, ruta text not null,
  vistas integer not null default 0, usuarios integer not null default 0,
  actualizado timestamptz not null default now(),
  primary key (dia, ruta)
);
create table if not exists marketing.ga4_ciudad (
  dia date not null, pais text not null, ciudad text not null,
  sesiones integer not null default 0,
  actualizado timestamptz not null default now(),
  primary key (dia, pais, ciudad)
);
create table if not exists marketing.sync_log (
  id bigint generated always as identity primary key,
  fuente text not null, inicio timestamptz not null default now(), fin timestamptz,
  estado text not null default 'iniciado', filas integer, detalle text
);
alter table marketing.ga4_dia enable row level security;
alter table marketing.ga4_fuente enable row level security;
alter table marketing.ga4_dispositivo enable row level security;
alter table marketing.ga4_pagina enable row level security;
alter table marketing.ga4_ciudad enable row level security;
alter table marketing.sync_log enable row level security;
revoke all on all tables in schema marketing from anon, authenticated;

-- Guardar (insertar o actualizar) filas de GA4. p_tabla: dia | fuente | dispositivo | pagina | ciudad. Devuelve cuántas filas escribió.
create or replace function public.marketing_guardar(p_token text, p_tabla text, p_filas jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare n integer := 0;
begin
  if not tienda.token_valido(p_token) then raise exception 'no autorizado'; end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then return jsonb_build_object('ok', false, 'error', 'Filas inválidas'); end if;
  if p_tabla = 'dia' then
    insert into marketing.ga4_dia (dia, sesiones, usuarios, nuevos, paginas_vistas, sesiones_activas, duracion_prom, add_carrito, inicia_compra, actualizado)
    select x.dia, coalesce(x.sesiones, 0), coalesce(x.usuarios, 0), coalesce(x.nuevos, 0), coalesce(x.paginas_vistas, 0), coalesce(x.sesiones_activas, 0), coalesce(x.duracion_prom, 0), coalesce(x.add_carrito, 0), coalesce(x.inicia_compra, 0), now()
    from jsonb_to_recordset(p_filas) as x(dia date, sesiones integer, usuarios integer, nuevos integer, paginas_vistas integer, sesiones_activas integer, duracion_prom numeric, add_carrito integer, inicia_compra integer)
    where x.dia is not null
    on conflict (dia) do update set sesiones = excluded.sesiones, usuarios = excluded.usuarios, nuevos = excluded.nuevos, paginas_vistas = excluded.paginas_vistas,
      sesiones_activas = excluded.sesiones_activas, duracion_prom = excluded.duracion_prom, add_carrito = excluded.add_carrito, inicia_compra = excluded.inicia_compra, actualizado = now();
  elsif p_tabla = 'fuente' then
    insert into marketing.ga4_fuente (dia, fuente, medio, sesiones, usuarios, actualizado)
    select x.dia, left(coalesce(nullif(x.fuente, ''), '(sin fuente)'), 120), left(coalesce(nullif(x.medio, ''), '(none)'), 120), coalesce(x.sesiones, 0), coalesce(x.usuarios, 0), now()
    from jsonb_to_recordset(p_filas) as x(dia date, fuente text, medio text, sesiones integer, usuarios integer) where x.dia is not null
    on conflict (dia, fuente, medio) do update set sesiones = excluded.sesiones, usuarios = excluded.usuarios, actualizado = now();
  elsif p_tabla = 'dispositivo' then
    insert into marketing.ga4_dispositivo (dia, dispositivo, sesiones, usuarios, actualizado)
    select x.dia, left(coalesce(nullif(x.dispositivo, ''), '(desconocido)'), 60), coalesce(x.sesiones, 0), coalesce(x.usuarios, 0), now()
    from jsonb_to_recordset(p_filas) as x(dia date, dispositivo text, sesiones integer, usuarios integer) where x.dia is not null
    on conflict (dia, dispositivo) do update set sesiones = excluded.sesiones, usuarios = excluded.usuarios, actualizado = now();
  elsif p_tabla = 'pagina' then
    insert into marketing.ga4_pagina (dia, ruta, vistas, usuarios, actualizado)
    select x.dia, left(coalesce(nullif(x.ruta, ''), '/'), 300), coalesce(x.vistas, 0), coalesce(x.usuarios, 0), now()
    from jsonb_to_recordset(p_filas) as x(dia date, ruta text, vistas integer, usuarios integer) where x.dia is not null
    on conflict (dia, ruta) do update set vistas = excluded.vistas, usuarios = excluded.usuarios, actualizado = now();
  elsif p_tabla = 'ciudad' then
    insert into marketing.ga4_ciudad (dia, pais, ciudad, sesiones, actualizado)
    select x.dia, left(coalesce(nullif(x.pais, ''), '(desconocido)'), 80), left(coalesce(nullif(x.ciudad, ''), '(desconocida)'), 80), coalesce(x.sesiones, 0), now()
    from jsonb_to_recordset(p_filas) as x(dia date, pais text, ciudad text, sesiones integer) where x.dia is not null
    on conflict (dia, pais, ciudad) do update set sesiones = excluded.sesiones, actualizado = now();
  else
    return jsonb_build_object('ok', false, 'error', 'Tabla desconocida');
  end if;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'filas', n);
end $function$;

-- Anotar cómo salió una actualización (para mostrar "Actualizado hace…" y ver errores).
create or replace function public.marketing_registrar_sync(p_token text, p_estado text, p_filas integer, p_detalle text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not tienda.token_valido(p_token) then raise exception 'no autorizado'; end if;
  insert into marketing.sync_log (fuente, fin, estado, filas, detalle) values ('ga4', now(), left(coalesce(p_estado, ''), 40), p_filas, left(coalesce(p_detalle, ''), 400));
  delete from marketing.sync_log where id in (select id from marketing.sync_log order by id desc offset 200);
  return jsonb_build_object('ok', true);
end $function$;

-- Datos del portal: periodo pedido (y, si se pide, otro periodo para comparar). Solo tráfico; nada de dinero.
create or replace function public.marketing_leer(p_token text, p_desde date, p_hasta date, p_cdesde date default null, p_chasta date default null)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare v_act jsonb; v_comp jsonb; v_dias jsonb; v_fuentes jsonb; v_disp jsonb; v_pags jsonb; v_ciud jsonb; v_ult timestamptz; v_ok jsonb;
begin
  if not tienda.token_valido(p_token) then raise exception 'no autorizado'; end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 800 then return jsonb_build_object('ok', false, 'error', 'Fechas inválidas'); end if;

  select jsonb_build_object('desde', p_desde, 'hasta', p_hasta, 'sesiones', coalesce(sum(sesiones), 0), 'nuevos', coalesce(sum(nuevos), 0), 'paginas_vistas', coalesce(sum(paginas_vistas), 0),
         'sesiones_activas', coalesce(sum(sesiones_activas), 0), 'usuarios_dia', coalesce(round(avg(nullif(usuarios, 0)), 1), 0),
         'duracion_prom', coalesce(round(sum(duracion_prom * sesiones) / nullif(sum(sesiones), 0), 1), 0), 'add_carrito', coalesce(sum(add_carrito), 0), 'inicia_compra', coalesce(sum(inicia_compra), 0), 'dias_con_datos', count(*))
    into v_act from marketing.ga4_dia where dia between p_desde and p_hasta;

  if p_cdesde is not null and p_chasta is not null and p_chasta >= p_cdesde then
    select jsonb_build_object('desde', p_cdesde, 'hasta', p_chasta, 'sesiones', coalesce(sum(sesiones), 0), 'nuevos', coalesce(sum(nuevos), 0), 'paginas_vistas', coalesce(sum(paginas_vistas), 0),
           'sesiones_activas', coalesce(sum(sesiones_activas), 0), 'usuarios_dia', coalesce(round(avg(nullif(usuarios, 0)), 1), 0),
           'duracion_prom', coalesce(round(sum(duracion_prom * sesiones) / nullif(sum(sesiones), 0), 1), 0), 'add_carrito', coalesce(sum(add_carrito), 0), 'inicia_compra', coalesce(sum(inicia_compra), 0), 'dias_con_datos', count(*))
      into v_comp from marketing.ga4_dia where dia between p_cdesde and p_chasta;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('dia', g.dia, 'sesiones', coalesce(d.sesiones, 0), 'paginas_vistas', coalesce(d.paginas_vistas, 0), 'add_carrito', coalesce(d.add_carrito, 0)) order by g.dia), '[]'::jsonb)
    into v_dias from (select x::date as dia from generate_series(p_desde, p_hasta, interval '1 day') x) g left join marketing.ga4_dia d on d.dia = g.dia;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.sesiones desc), '[]'::jsonb) into v_fuentes from (
    select fuente, medio, sum(sesiones)::int as sesiones from marketing.ga4_fuente where dia between p_desde and p_hasta group by 1, 2 order by 3 desc limit 15) r;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.sesiones desc), '[]'::jsonb) into v_disp from (
    select dispositivo, sum(sesiones)::int as sesiones from marketing.ga4_dispositivo where dia between p_desde and p_hasta group by 1 order by 2 desc) r;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.vistas desc), '[]'::jsonb) into v_pags from (
    select ruta, sum(vistas)::int as vistas from marketing.ga4_pagina where dia between p_desde and p_hasta group by 1 order by 2 desc limit 15) r;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.sesiones desc), '[]'::jsonb) into v_ciud from (
    select pais, ciudad, sum(sesiones)::int as sesiones from marketing.ga4_ciudad where dia between p_desde and p_hasta group by 1, 2 order by 3 desc limit 10) r;

  select max(actualizado) into v_ult from marketing.ga4_dia;
  select to_jsonb(s) into v_ok from (select estado, filas, detalle, fin from marketing.sync_log order by id desc limit 1) s;
  return jsonb_build_object('ok', true, 'actual', v_act, 'comparacion', v_comp, 'dias', v_dias, 'fuentes', v_fuentes, 'dispositivos', v_disp, 'paginas', v_pags, 'ciudades', v_ciud,
                            'actualizado', v_ult, 'ultima_sync', v_ok);
end $function$;
