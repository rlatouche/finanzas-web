import { supabase } from './supabaseClient.js';

export async function buscarHistorialWeb(filtros) {
  let query = supabase
    .from('transacciones')
    .select('*')
    .order('fecha', { ascending: false })
    .order('id', { ascending: false })
    .limit(250);

  if (filtros.inicio) query = query.gte('fecha', filtros.inicio);
  if (filtros.fin) query = query.lte('fecha', filtros.fin);
  if (filtros.beneficiario) query = query.eq('beneficiario', filtros.beneficiario);
  if (filtros.cuenta) query = query.eq('cuenta', filtros.cuenta);
  if (filtros.categoria) query = query.eq('categoria', filtros.categoria);

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map(row => {
    const montoReal = parseFloat(row.monto_real) || 0;
    const montoRef = parseFloat(row.monto_referencia) || 0;
    const montoFinal = (montoReal !== 0) ? montoReal : montoRef;

    const partesFecha = String(row.fecha).split('-');
    const fechaFormateada = partesFecha.length === 3
      ? `${partesFecha[2]}/${partesFecha[1]}/${partesFecha[0]}`
      : row.fecha;

    return {
      idFila: row.id,
      fecha: fechaFormateada,
      fechaISO: row.fecha,
      beneficiario: row.beneficiario || '',
      cuenta: row.cuenta || '',
      memo: row.memo || '',
      monto: montoFinal,
      categoria: row.categoria || '',
      subcategoria: row.subcategoria || '',
      tipo: row.tipo || '',
      idTransaccion: String(row.id_transaccion),
      conciliado: Boolean(row.conciliado),
      moneda: row.moneda || 'COP'
    };
  });
}

export async function obtenerMovimientoPorIdWeb(idTx) {
  const idStr = String(idTx).trim();
  const serie = idStr.charAt(0);

  const { data: filas, error } = await supabase
    .from('transacciones')
    .select('*')
    .eq('id_transaccion', parseInt(idStr, 10))
    .order('id', { ascending: true });

  if (error) throw error;

  const resultado = { id: idStr, serie, filaPrincipal: null, desgloses: [] };
  const idsConsumidos = [];

  (filas || []).forEach(row => {
    const montoReal = parseFloat(row.monto_real) || 0;
    const montoRef = parseFloat(row.monto_referencia) || 0;

    const filaFormateada = {
      fecha: row.fecha,
      beneficiario: row.beneficiario || '',
      cuenta: row.cuenta || '',
      memo: row.memo || '',
      monto: montoReal,
      categoria: row.categoria || '',
      subcategoria: row.subcategoria || '',
      tipo: (row.categoria === 'Transferencia') ? 'TRANSFERENCIA' : row.tipo,
      montoRef
    };

    if (serie === '3') {
      if (montoRef !== 0 && row.memo !== 'SUBPARTIDA' && row.beneficiario !== '') {
        if (!resultado.filaPrincipal) resultado.filaPrincipal = filaFormateada;
      } else if (filaFormateada.tipo === 'TRANSFERENCIA') {
        if (filaFormateada.monto < 0) {
          const contrapartida = filas.find(f =>
            !idsConsumidos.includes(f.id) &&
            f.cuenta !== row.cuenta &&
            parseFloat(f.monto_real) > 0
          );
          if (contrapartida) {
            idsConsumidos.push(contrapartida.id);
            filaFormateada.cuentaDestino = contrapartida.cuenta;
            filaFormateada.montoDivisa = parseFloat(contrapartida.monto_real);
          } else {
            filaFormateada.cuentaDestino = '';
            filaFormateada.montoDivisa = 0;
          }
          resultado.desgloses.push(filaFormateada);
        }
      } else {
        resultado.desgloses.push(filaFormateada);
      }
    } else if (serie === '2') {
      if (filaFormateada.monto < 0) resultado.filaPrincipal = filaFormateada;
      else resultado.desgloses.push(filaFormateada);
    } else {
      resultado.filaPrincipal = filaFormateada;
    }
  });

  return resultado;
}

export async function eliminarMovimientoWeb(idTx) {
  const { error } = await supabase
    .from('transacciones')
    .delete()
    .eq('id_transaccion', parseInt(String(idTx), 10));
  if (error) throw error;
}

export async function guardarConciliacionWeb(cambios) {
  const promesas = cambios.map(item =>
    supabase
      .from('transacciones')
      .update({ conciliado: Boolean(item.estado) })
      .eq('id', item.idFila)
  );
  const resultados = await Promise.all(promesas);
  const fallo = resultados.find(r => r.error);
  if (fallo) throw fallo.error;
  return `✅ Conciliación guardada en ${cambios.length} registros.`;
}

export async function obtenerSaldosConciliacionWeb(cuenta, fechaDesde, fechaHasta) {
  const fInicio = new Date(fechaDesde + 'T00:00:00');
  fInicio.setDate(fInicio.getDate() - 1);
  const fechaAnterior = fInicio.toISOString().split('T')[0];

  const [resInicial, resFinal] = await Promise.all([
    supabase.rpc('calcular_saldos_hasta', { fecha_corte: fechaAnterior }),
    supabase.rpc('calcular_saldos_hasta', { fecha_corte: fechaHasta })
  ]);

  if (resInicial.error) throw resInicial.error;
  if (resFinal.error) throw resFinal.error;

  const filaIni = (resInicial.data || []).find(r => r.cuenta === cuenta);
  const filaFin = (resFinal.data || []).find(r => r.cuenta === cuenta);

  return {
    inicial: filaIni ? (parseFloat(filaIni.total) || 0) : 0,
    final: filaFin ? (parseFloat(filaFin.total) || 0) : 0
  };
}