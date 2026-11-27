-- Panel de marketing: Instagram de Apex (2026-11-27). Datos públicos de la cuenta traídos con Apify (apify/instagram-scraper), igual que el monitor de Going.
-- Proyecto Supabase "Active Food" (ngbrcbweduazaoidavza). Aditivo: 2 tablas nuevas en el esquema `marketing` y 4 funciones (más la nueva definición de marketing_leer). No toca nada existente.
-- Solo datos públicos de Instagram (seguidores, publicaciones, me gusta, comentarios, vistas). Nada de dinero ni ventas.
-- Seguridad: igual que el resto de `marketing`: RLS activo, sin permisos para anon/authenticated, solo se llega con las funciones (token del Worker).

create table if not exists marketing.ig_perfil (
  dia date not null,
  usuario text not null,
  seguidores integer not null default 0,
  actualizado timestamptz not null default now(),
  primary key (dia, usuario)
);
create table if not exists marketing.ig_post (
  shortcode text primary key,
  usuario text not null,
  tipo text not null default 'imagen',          -- imagen | video | carrusel
  publicado timestamptz not null,
  me_gusta integer,                              -- null = la cuenta oculta los me gusta
  comentarios integer not null default 0,
  vistas integer,                                -- solo videos / reels
  texto text,
  url text,
  actualizado timestamptz not null default now()
);
create index if not exists ig_post_usuario_fecha on marketing.ig_post (usuario, publicado desc);
alter table marketing.ig_perfil enable row level security;
alter table marketing.ig_post enable row level security;
revoke all on marketing.ig_perfil, marketing.ig_post from anon, authenticated;

-- Guardar la foto del día: seguidores del perfil + las publicaciones recientes (se actualizan sus me gusta y comentarios).
create or replace function public.marketing_ig_guardar(p_token text, p_usuario text, p_seguidores integer, p_posts jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare n integer := 0; v_hoy date := (now() at time zone 'America/Caracas')::date;
begin
  if not tienda.token_valido(p_token) then raise exception 'no autorizado'; end if;
  if p_usuario is null or p_usuario !~ '^[a-z0-9._]{1,40}$' then return jsonb_build_object('ok', false, 'error', 'Usuario inválido'); end if;
  if p_seguidores is not null and p_seguidores > 0 then
    insert into marketing.ig_perfil (dia, usuario, seguidores, actualizado) values (v_hoy, p_usuario, p_seguidores, now())
    on conflict (dia, usuario) do update set seguidores = excluded.seguidores, actualizado = now();
  end if;
  if p_posts is not null and jsonb_typeof(p_posts) = 'array' then
    insert into marketing.ig_post (shortcode, usuario, tipo, publicado, me_gusta, comentarios, vistas, texto, url, actualizado)
    select left(x.shortcode, 40), p_usuario, case when x.tipo in ('imagen', 'video', 'carrusel') then x.tipo else 'imagen' end, x.publicado,
           case when x.me_gusta is null or x.me_gusta < 0 then null else x.me_gusta end, greatest(coalesce(x.comentarios, 0), 0),
           case when x.vistas is null or x.vistas < 0 then null else x.vistas end, left(x.texto, 600), left(x.url, 300), now()
    from jsonb_to_recordset(p_posts) as x(shortcode text, tipo text, publicado timestamptz, me_gusta integer, comentarios integer, vistas integer, texto text, url text)
    where x.shortcode is not null and x.publicado is not null
    on conflict (shortcode) do update set tipo = excluded.tipo, me_gusta = excluded.me_gusta, comentarios = excluded.comentarios,
      vistas = excluded.vistas, texto = excluded.texto, url = excluded.url, actualizado = now();
    get diagnostics n = row_count;
  end if;
  return jsonb_build_object('ok', true, 'posts', n);
end $function$;

-- Datos del portal para un periodo (y otro para comparar): seguidores, publicaciones, interacción, por formato y las mejores publicaciones.
create or replace function public.marketing_ig_leer(p_token text, p_usuario text, p_desde date, p_hasta date, p_cdesde date default null, p_chasta date default null)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare v_seg_fin integer; v_seg_ini integer; v_act jsonb; v_comp jsonb; v_tipos jsonb; v_top jsonb; v_serie jsonb; v_ult timestamptz;
begin
  if not tienda.token_valido(p_token) then raise exception 'no autorizado'; end if;
  if p_usuario is null or p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 800 then return jsonb_build_object('ok', false, 'error', 'Fechas inválidas'); end if;

  select seguidores into v_seg_fin from marketing.ig_perfil where usuario = p_usuario and dia <= p_hasta order by dia desc limit 1;
  select seguidores into v_seg_ini from marketing.ig_perfil where usuario = p_usuario and dia <= p_desde order by dia desc limit 1;
  if v_seg_ini is null then select seguidores into v_seg_ini from marketing.ig_perfil where usuario = p_usuario and dia >= p_desde order by dia asc limit 1; end if;

  select jsonb_build_object('desde', p_desde, 'hasta', p_hasta, 'publicaciones', count(*), 'me_gusta', coalesce(sum(me_gusta), 0), 'comentarios', coalesce(sum(comentarios), 0),
         'vistas', coalesce(sum(vistas), 0), 'con_me_gusta', count(me_gusta),
         'seguidores', v_seg_fin, 'seguidores_inicio', v_seg_ini)
    into v_act from marketing.ig_post where usuario = p_usuario and (publicado at time zone 'America/Caracas')::date between p_desde and p_hasta;

  if p_cdesde is not null and p_chasta is not null and p_chasta >= p_cdesde then
    select jsonb_build_object('desde', p_cdesde, 'hasta', p_chasta, 'publicaciones', count(*), 'me_gusta', coalesce(sum(me_gusta), 0), 'comentarios', coalesce(sum(comentarios), 0),
           'vistas', coalesce(sum(vistas), 0), 'con_me_gusta', count(me_gusta))
      into v_comp from marketing.ig_post where usuario = p_usuario and (publicado at time zone 'America/Caracas')::date between p_cdesde and p_chasta;
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.publicaciones desc), '[]'::jsonb) into v_tipos from (
    select tipo, count(*)::int as publicaciones, round(avg(me_gusta), 1) as me_gusta_prom, round(avg(comentarios), 1) as comentarios_prom, round(avg(vistas), 0) as vistas_prom
    from marketing.ig_post where usuario = p_usuario and (publicado at time zone 'America/Caracas')::date between p_desde and p_hasta group by tipo) r;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.interaccion desc), '[]'::jsonb) into v_top from (
    select tipo, (publicado at time zone 'America/Caracas')::date as dia, me_gusta, comentarios, vistas, left(texto, 140) as texto, url, coalesce(me_gusta, 0) + comentarios as interaccion
    from marketing.ig_post where usuario = p_usuario and (publicado at time zone 'America/Caracas')::date between p_desde and p_hasta
    order by coalesce(me_gusta, 0) + comentarios desc limit 5) r;

  select coalesce(jsonb_agg(jsonb_build_object('dia', dia, 'seguidores', seguidores) order by dia), '[]'::jsonb) into v_serie
    from marketing.ig_perfil where usuario = p_usuario and dia between p_desde and p_hasta;

  select max(actualizado) into v_ult from marketing.ig_perfil where usuario = p_usuario;
  return jsonb_build_object('ok', true, 'usuario', p_usuario, 'actual', v_act, 'comparacion', v_comp, 'tipos', v_tipos, 'top', v_top, 'seguidores_dias', v_serie, 'actualizado', v_ult);
end $function$;

-- Anotar cómo salió una carga de Instagram (para mostrar errores y "actualizado hace…").
create or replace function public.marketing_ig_registrar(p_token text, p_estado text, p_filas integer, p_detalle text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not tienda.token_valido(p_token) then raise exception 'no autorizado'; end if;
  insert into marketing.sync_log (fuente, fin, estado, filas, detalle) values ('instagram', now(), left(coalesce(p_estado, ''), 40), p_filas, left(coalesce(p_detalle, ''), 400));
  delete from marketing.sync_log where fuente = 'instagram' and id in (select id from marketing.sync_log where fuente = 'instagram' order by id desc offset 100);
  return jsonb_build_object('ok', true);
end $function$;

-- Última carga de Instagram (para el portal).
create or replace function public.marketing_ig_ultima(p_token text)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare v jsonb;
begin
  if not tienda.token_valido(p_token) then raise exception 'no autorizado'; end if;
  select to_jsonb(s) into v from (select estado, filas, detalle, fin from marketing.sync_log where fuente = 'instagram' order by id desc limit 1) s;
  return coalesce(v, 'null'::jsonb);
end $function$;

-- (Se vuelve a definir marketing_leer para que "última carga" mire solo las de Google Analytics y no las de Instagram.)
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
  select to_jsonb(s) into v_ok from (select estado, filas, detalle, fin from marketing.sync_log where fuente = 'ga4' order by id desc limit 1) s;
  return jsonb_build_object('ok', true, 'actual', v_act, 'comparacion', v_comp, 'dias', v_dias, 'fuentes', v_fuentes, 'dispositivos', v_disp, 'paginas', v_pags, 'ciudades', v_ciud,
                            'actualizado', v_ult, 'ultima_sync', v_ok);
end $function$;
