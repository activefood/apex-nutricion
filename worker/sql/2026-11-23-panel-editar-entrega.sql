-- Panel de pedidos: registrar la entrega (tipo, quién paga y monto) al confirmar un pedido.
-- Proyecto Supabase "Active Food" (ngbrcbweduazaoidavza). Aditivo: crea una tabla de historial y una función nueva. Nada se borra.

create table if not exists tienda.pedido_cambios (
  id bigint generated always as identity primary key,
  oc text not null,
  campo text not null,
  antes text,
  despues text,
  cambiado_en timestamptz not null default now()
);
alter table tienda.pedido_cambios enable row level security;
revoke all on tienda.pedido_cambios from anon, authenticated;

create or replace function public.tienda_panel_editar_entrega(p_token text, p_oc text, p_tipo text, p_paga text default null, p_valor text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare p tienda.pedidos%rowtype; v_oc text; v_val text; v_entrega text; v_paga text;
begin
  if not tienda.token_valido(p_token) then raise exception 'no autorizado'; end if;
  if p_oc is null or p_oc !~ '^[0-9]{1,8}$' then return jsonb_build_object('ok', false, 'error', 'Número de pedido inválido'); end if;
  if p_tipo is null or p_tipo not in ('pickup', 'delivery') then return jsonb_build_object('ok', false, 'error', 'Elige Delivery o Pick up.'); end if;
  v_oc := lpad(p_oc::bigint::text, 5, '0');
  select * into p from tienda.pedidos where oc = v_oc and origen = 'web' for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'Pedido no encontrado: ' || p_oc); end if;
  if p.estado <> 'Completed' then return jsonb_build_object('ok', false, 'error', 'Solo se corrige la entrega de pedidos confirmados.'); end if;
  if p_tipo = 'pickup' then
    v_entrega := 'Pickup'; v_paga := null;
  else
    if p_paga is null or p_paga not in ('Cliente', 'Tienda') then return jsonb_build_object('ok', false, 'error', 'Elige quién paga el delivery.'); end if;
    v_paga := p_paga;
    v_val := nullif(btrim(coalesce(p_valor, '')), '');
    if v_val is not null then
      v_entrega := tienda.normalizar_entrega(v_val);
      if v_entrega is null then return jsonb_build_object('ok', false, 'error', 'Monto inválido.'); end if;
    else
      v_entrega := null;   -- sin monto todavía: el pedido queda en "falta el monto"
    end if;
  end if;
  if p.entrega is distinct from v_entrega then
    insert into tienda.pedido_cambios (oc, campo, antes, despues) values (p.oc, 'entrega', p.entrega, v_entrega);
  end if;
  if p.entrega_paga is distinct from v_paga then
    insert into tienda.pedido_cambios (oc, campo, antes, despues) values (p.oc, 'entrega_paga', p.entrega_paga, v_paga);
  end if;
  update tienda.pedidos set entrega = v_entrega, entrega_paga = v_paga where id = p.id;
  return jsonb_build_object('ok', true);
end $function$;
