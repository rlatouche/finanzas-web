import { supabase } from './supabaseClient.js';

function restarUnDia(fechaISO) {
  const d = new Date(`${fechaISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split('T')[0];
}

export async function obtenerExtractoCuentaWeb(cuenta, fechaDesde, fechaHasta) {
  if (!cuenta || !fechaDesde || !fechaHasta) {
    throw new Error('Debes seleccionar Cuenta, Fecha Inicio y Fecha Final.');
  }
  if (fechaDesde > fechaHasta) {
    throw new Error('La Fecha de Inicio no puede ser mayor que la Fecha Final.');
  }

  // 1. Obtener metadatos de la cuenta
  const { data: infoCuenta, error: errCta } = await supabase
    .from('cuentas')
    .select('nombre, institucion, tipo_cuenta, moneda_codigo')
    .eq('nombre', cuenta)
    .single();

  if (errCta) throw errCta;
  const moneda = (infoCuenta?.moneda_codigo || 'COP').toUpperCase();

  // 2. Calcular Saldo Inicial exacto en PostgreSQL hasta el día anterior a fechaDesde
  // (Usa el mismo RPC que Saldos e Historial, sin límite de 1.000 filas)
  const diaAnterior = restarUnDia(fechaDesde);
  const { data: saldosRPC, error: errRPC } = await supabase.rpc('calcular_saldos_hasta', {
    fecha_corte: diaAnterior
  });

  if (errRPC) throw errRPC;

  const filaCuenta = (saldosRPC || []).find(r => r.cuenta === cuenta);
  const saldoInicial = filaCuenta ? (parseFloat(filaCuenta.total) || 0) : 0;

  // 3. Obtener TODOS los movimientos del periodo paginando en bloques de 1000
  let movs = [];
  let desdeIdx = 0;
  const tamPagina = 1000;

  while (true) {
    const { data: lote, error: errMovs } = await supabase
      .from('transacciones')
      .select('id, fecha, beneficiario, categoria, subcategoria, memo, monto_real, conciliado')
      .eq('cuenta', cuenta)
      .gte('fecha', fechaDesde)
      .lte('fecha', fechaHasta)
      .order('fecha', { ascending: true })
      .order('id', { ascending: true })
      .range(desdeIdx, desdeIdx + tamPagina - 1);

    if (errMovs) throw errMovs;
    if (!lote || lote.length === 0) break;

    movs = movs.concat(lote);
    if (lote.length < tamPagina) break;
    desdeIdx += tamPagina;
  }

  // 4. Calcular saldo acumulado línea por línea
  let acumulado = saldoInicial;
  let totalIngresos = 0;
  let totalEgresos = 0;

  const movimientos = movs.map(m => {
    const monto = parseFloat(m.monto_real) || 0;
    if (monto >= 0) totalIngresos += monto;
    else totalEgresos += monto;

    acumulado += monto;

    return {
      id: m.id,
      fecha: m.fecha,
      beneficiario: m.beneficiario || '',
      categoria: m.categoria || '',
      subcategoria: m.subcategoria || '',
      memo: m.memo || '',
      monto,
      saldoAcumulado: acumulado,
      conciliado: Boolean(m.conciliado)
    };
  });

  return {
    cuenta: infoCuenta,
    moneda,
    fechaDesde,
    fechaHasta,
    saldoInicial,
    totalIngresos,
    totalEgresos,
    saldoFinal: acumulado,
    movimientos
  };
}
