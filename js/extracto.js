import { supabase } from './supabaseClient.js';

export async function obtenerExtractoCuentaWeb(cuenta, fechaDesde, fechaHasta) {
  if (!cuenta || !fechaDesde || !fechaHasta) {
    throw new Error('Debes seleccionar Cuenta, Fecha Inicio y Fecha Final.');
  }
  if (fechaDesde > fechaHasta) {
    throw new Error('La Fecha de Inicio no puede ser mayor que la Fecha Final.');
  }

  // 1. Obtener metadatos de la cuenta (moneda, institución, saldo_inicial)
  const { data: infoCuenta, error: errCta } = await supabase
    .from('cuentas')
    .select('nombre, institucion, tipo_cuenta, moneda_codigo, saldo_inicial')
    .eq('nombre', cuenta)
    .single();

  if (errCta) throw errCta;

  const moneda = (infoCuenta?.moneda_codigo || 'COP').toUpperCase();
  const saldoBaseApertura = parseFloat(infoCuenta?.saldo_inicial) || 0;

  // 2. Calcular Saldo Inicial (movimientos estrictamente anteriores a fechaDesde)
  const { data: prevTxs, error: errPrev } = await supabase
    .from('transacciones')
    .select('monto_real')
    .eq('cuenta', cuenta)
    .lt('fecha', fechaDesde)
    .limit(50000);

  if (errPrev) throw errPrev;

  const sumaAnterior = (prevTxs || []).reduce(
    (acc, row) => acc + (parseFloat(row.monto_real) || 0),
    0
  );
  const saldoInicial = saldoBaseApertura + sumaAnterior;

  // 3. Obtener movimientos del periodo ordenado cronológicamente
  const { data: movs, error: errMovs } = await supabase
    .from('transacciones')
    .select('id, fecha, beneficiario, categoria, subcategoria, memo, monto_real, conciliado')
    .eq('cuenta', cuenta)
    .gte('fecha', fechaDesde)
    .lte('fecha', fechaHasta)
    .order('fecha', { ascending: true })
    .order('id', { ascending: true })
    .limit(50000);

  if (errMovs) throw errMovs;

  // 4. Calcular saldo acumulado línea por línea
  let acumulado = saldoInicial;
  let totalIngresos = 0;
  let totalEgresos = 0;

  const movimientos = (movs || []).map(m => {
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
