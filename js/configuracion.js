import { supabase } from './supabaseClient.js';

function escaparRegex(texto) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================================
// 1. GESTIÓN DE CUENTAS
// ============================================================================

export async function obtenerDatosCuentasWeb() {
  const { data, error } = await supabase
    .from('cuentas')
    .select('*')
    .order('nombre', { ascending: true });

  if (error) throw error;

  return (data || []).map(c => ({
    idFila: c.id,
    institucion: c.institucion || '',
    tipo: c.tipo_cuenta || '',
    nombre: c.nombre,
    fechaApertura: c.fecha_apertura || '',
    moneda: c.moneda_codigo || 'COP',
    estado: c.estado || 'Activa'
  }));
}

export async function obtenerListasConfiguracionWeb() {
  const [resCuentas, resMonedas] = await Promise.all([
    supabase.from('cuentas').select('institucion'),
    supabase.from('monedas').select('codigo').order('codigo', { ascending: true })
  ]);

  if (resCuentas.error) throw resCuentas.error;
  if (resMonedas.error) throw resMonedas.error;

  const instituciones = [...new Set(
    (resCuentas.data || []).map(c => (c.institucion || '').trim()).filter(Boolean)
  )].sort();

  const monedas = (resMonedas.data || []).map(m => m.codigo);

  return { instituciones, monedas };
}

export async function guardarCuentaWeb(c) {
  const payload = {
    institucion: (c.institucion || '').trim(),
    tipo_cuenta: (c.tipo || '').trim(),
    nombre: (c.nombre || '').trim(),
    fecha_apertura: c.fecha && c.fecha.trim() !== '' ? c.fecha.trim() : null,
    moneda_codigo: (c.moneda || 'COP').trim().toUpperCase(),
    estado: c.estado || 'Activa'
  };

  if (c.idFila && String(c.idFila).trim() !== '') {
    const idNum = parseInt(c.idFila, 10);
    const { data: actual, error: errGet } = await supabase
      .from('cuentas')
      .select('nombre')
      .eq('id', idNum)
      .single();

    if (errGet) throw errGet;

    const nombreAnterior = actual ? actual.nombre : '';
    const nombreNuevo = payload.nombre;

    if (nombreAnterior && nombreAnterior !== nombreNuevo) {
      await actualizarHistorialCuentasWeb(nombreAnterior, nombreNuevo);
    }

    const { error: errUpd } = await supabase
      .from('cuentas')
      .update(payload)
      .eq('id', idNum);

    if (errUpd) throw errUpd;
  } else {
    payload.saldo_inicial = 0;
    const { error: errIns } = await supabase
      .from('cuentas')
      .insert(payload);

    if (errIns) throw errIns;
  }

  return '✅ Cuenta guardada correctamente en Supabase.';
}

async function actualizarHistorialCuentasWeb(anterior, nuevo) {
  // 1. Actualizar columna 'cuenta' en transacciones directas
  const { error: errCuenta } = await supabase
    .from('transacciones')
    .update({ cuenta: nuevo })
    .eq('cuenta', anterior);

  if (errCuenta) throw errCuenta;

  // 2. Actualizar referencias en 'subcategoria' y 'beneficiario' para transferencias
  const { data: txRelacionadas, error: errTx } = await supabase
    .from('transacciones')
    .select('id, subcategoria, beneficiario')
    .eq('categoria', 'Transferencia');

  if (errTx) throw errTx;

  const regexDesde = new RegExp('(desde )' + escaparRegex(anterior) + '$', 'i');
  const regexA = new RegExp('(a )' + escaparRegex(anterior) + '$', 'i');

  const actualizaciones = [];

  (txRelacionadas || []).forEach(tx => {
    const cambios = {};
    let modificado = false;

    if (tx.subcategoria) {
      if (regexDesde.test(tx.subcategoria)) {
        cambios.subcategoria = tx.subcategoria.replace(regexDesde, '$1' + nuevo);
        modificado = true;
      } else if (regexA.test(tx.subcategoria)) {
        cambios.subcategoria = tx.subcategoria.replace(regexA, '$1' + nuevo);
        modificado = true;
      }
    }

    if (tx.beneficiario) {
      if (regexDesde.test(tx.beneficiario)) {
        cambios.beneficiario = tx.beneficiario.replace(regexDesde, '$1' + nuevo);
        modificado = true;
      } else if (regexA.test(tx.beneficiario)) {
        cambios.beneficiario = tx.beneficiario.replace(regexA, '$1' + nuevo);
        modificado = true;
      }
    }

    if (modificado) {
      actualizaciones.push(
        supabase.from('transacciones').update(cambios).eq('id', tx.id)
      );
    }
  });

  if (actualizaciones.length > 0) {
    await Promise.all(actualizaciones);
  }
}

// ============================================================================
// 2. GESTIÓN DE BENEFICIARIOS
// ============================================================================

export async function obtenerDatosBeneficiariosWeb() {
  const [resBen, resTx] = await Promise.all([
    supabase.from('beneficiarios').select('*').order('nombre', { ascending: true }),
    supabase.from('transacciones').select('beneficiario, fecha')
  ]);

  if (resBen.error) throw resBen.error;
  if (resTx.error) throw resTx.error;

  const estadisticas = {};
  (resTx.data || []).forEach(tx => {
    const nombre = tx.beneficiario;
    if (!nombre) return;
    if (!estadisticas[nombre]) {
      estadisticas[nombre] = { usos: 0, ultimaFecha: '' };
    }
    estadisticas[nombre].usos++;
    if (!estadisticas[nombre].ultimaFecha || tx.fecha > estadisticas[nombre].ultimaFecha) {
      estadisticas[nombre].ultimaFecha = tx.fecha;
    }
  });

  return (resBen.data || []).map(b => {
    const stats = estadisticas[b.nombre] || { usos: 0, ultimaFecha: '' };
    let fechaFmt = 'Sin registros';
    if (stats.ultimaFecha) {
      const p = String(stats.ultimaFecha).split('-');
      fechaFmt = p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : stats.ultimaFecha;
    }

    return {
      idFila: b.id,
      nombre: b.nombre,
      estado: b.estado || 'Activo',
      usos: stats.usos,
      ultimaFecha: fechaFmt
    };
  });
}

export async function guardarBeneficiarioWeb(b) {
  const nombreNuevo = b.nombre.trim();
  const estadoNuevo = b.estado || 'Activo';

  if (b.idFila && String(b.idFila).trim() !== '') {
    const idNum = parseInt(b.idFila, 10);
    const { data: actual, error: errGet } = await supabase
      .from('beneficiarios')
      .select('nombre')
      .eq('id', idNum)
      .single();

    if (errGet) throw errGet;

    const nombreAnterior = actual ? actual.nombre : '';

    if (nombreAnterior && nombreAnterior !== nombreNuevo) {
      const { error: errTx } = await supabase
        .from('transacciones')
        .update({ beneficiario: nombreNuevo })
        .eq('beneficiario', nombreAnterior);
      if (errTx) throw errTx;
    }

    const { error: errUpd } = await supabase
      .from('beneficiarios')
      .update({ nombre: nombreNuevo, estado: estadoNuevo })
      .eq('id', idNum);
    if (errUpd) throw errUpd;
  } else {
    const { error: errIns } = await supabase
      .from('beneficiarios')
      .upsert({ nombre: nombreNuevo, estado: estadoNuevo }, { onConflict: 'nombre' });
    if (errIns) throw errIns;
  }

  return '✅ Beneficiario guardado y sincronizado con el historial.';
}

export async function eliminarBeneficiarioWeb(idFila, nombre) {
  const { error } = await supabase
    .from('beneficiarios')
    .delete()
    .eq('id', parseInt(idFila, 10));

  if (error) throw error;
  return `🗑️ ${nombre} eliminado de la base de datos.`;
}

export async function fusionarBeneficiariosWeb(nombresViejos, nombreFinal) {
  const destinoLimpio = nombreFinal.trim();

  for (const viejo of nombresViejos) {
    if (viejo !== destinoLimpio) {
      const { error: errTx } = await supabase
        .from('transacciones')
        .update({ beneficiario: destinoLimpio })
        .eq('beneficiario', viejo);
      if (errTx) throw errTx;

      const { error: errDel } = await supabase
        .from('beneficiarios')
        .delete()
        .eq('nombre', viejo);
      if (errDel) throw errDel;
    }
  }

  const { error: errUpsert } = await supabase
    .from('beneficiarios')
    .upsert({ nombre: destinoLimpio, estado: 'Activo' }, { onConflict: 'nombre' });
  if (errUpsert) throw errUpsert;

  return `✨ Fusión completada. Todos los registros ahora están bajo "${destinoLimpio}".`;
}

// ============================================================================
// 3. GESTIÓN DE CATEGORÍAS Y SUBCATEGORÍAS
// ============================================================================

export async function obtenerCategoriasPrincipalesWeb() {
  const { data, error } = await supabase
    .from('categorias')
    .select('categoria, tipo')
    .order('tipo', { ascending: true })
    .order('categoria', { ascending: true });

  if (error) throw error;

  const unicas = {};
  (data || []).forEach(row => {
    if (row.categoria && !unicas[row.categoria]) {
      unicas[row.categoria] = {
        nombre: row.categoria,
        tipo: row.tipo || 'Gasto'
      };
    }
  });

  return Object.values(unicas);
}

export async function obtenerSubcategoriasPorCatWeb(nombreCategoria) {
  const { data, error } = await supabase
    .from('categorias')
    .select('*')
    .eq('categoria', nombreCategoria)
    .order('subcategoria', { ascending: true });

  if (error) throw error;

  return (data || []).map(row => ({
    cat: row.categoria,
    sub: row.subcategoria,
    tipo: row.tipo,
    idFila: row.id
  }));
}

export async function guardarCategoriaWeb(datos) {
  let tipoNorm = datos.tipo || 'Gasto';
  if (tipoNorm.toLowerCase() === 'egreso') tipoNorm = 'Gasto';

  const payload = {
    categoria: datos.categoria.trim(),
    subcategoria: (datos.subcategoria || '').trim(),
    tipo: tipoNorm
  };

  if (datos.idFila && String(datos.idFila).trim() !== '') {
    const { error } = await supabase
      .from('categorias')
      .update(payload)
      .eq('id', parseInt(datos.idFila, 10));
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('categorias')
      .upsert(payload, { onConflict: 'categoria,subcategoria,tipo' });
    if (error) throw error;
  }

  return '✅ Categoría guardada correctamente en Supabase.';
}

export async function renombrarCategoriaPrincipalWeb(nombreAnterior, nombreNuevo) {
  const ant = nombreAnterior.trim();
  const nue = nombreNuevo.trim();

  const { error: errCat } = await supabase
    .from('categorias')
    .update({ categoria: nue })
    .eq('categoria', ant);
  if (errCat) throw errCat;

  const { error: errTx } = await supabase
    .from('transacciones')
    .update({ categoria: nue })
    .eq('categoria', ant);
  if (errTx) throw errTx;

  return `✅ Categoría renombrada de '${ant}' a '${nue}' en todo el sistema.`;
}

export async function actualizarSubcategoriaMasivoWeb(idFila, catPadre, subAntigua, subNueva, tipo) {
  let tipoNorm = tipo || 'Gasto';
  if (tipoNorm.toLowerCase() === 'egreso') tipoNorm = 'Gasto';

  const { error: errCat } = await supabase
    .from('categorias')
    .update({
      categoria: catPadre.trim(),
      subcategoria: subNueva.trim(),
      tipo: tipoNorm
    })
    .eq('id', parseInt(idFila, 10));
  if (errCat) throw errCat;

  const { error: errTx } = await supabase
    .from('transacciones')
    .update({ subcategoria: subNueva.trim() })
    .eq('categoria', catPadre.trim())
    .eq('subcategoria', subAntigua.trim());
  if (errTx) throw errTx;

  return `✅ Subcategoría actualizada a '${subNueva}' en todo el historial.`;
}