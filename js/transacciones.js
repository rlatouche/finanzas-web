import { supabase } from "./supabaseClient.js";

// --- 1. CATÁLOGOS Y AUTOCOMPLETADO ---

export async function obtenerCatalogosWeb() {
  const [resCuentas, resBen, resCat] = await Promise.all([
    supabase
      .from("cuentas")
      .select("nombre, moneda_codigo, estado")
      .order("nombre", { ascending: true }),
    supabase
      .from("beneficiarios")
      .select("nombre, estado")
      .order("nombre", { ascending: true }),
    supabase
      .from("categorias")
      .select("categoria, subcategoria, tipo")
      .order("categoria", { ascending: true }),
  ]);

  if (resCuentas.error) throw resCuentas.error;
  if (resBen.error) throw resBen.error;
  if (resCat.error) throw resCat.error;

  const cuentasActivas = resCuentas.data.filter(
    (c) => c.estado === "Activa" || c.estado === "Activo",
  );
  const cuentas = cuentasActivas.map((c) => c.nombre);
  const mapaCuentas = {};
  cuentasActivas.forEach((c) => {
    if (c.nombre) mapaCuentas[c.nombre.trim()] = c.moneda_codigo || "COP";
  });

  const beneficiarios = resBen.data
    .filter((b) => b.estado === "Activo")
    .map((b) => b.nombre);

  const relacion = {};
  const tiposCat = {};
  resCat.data.forEach((c) => {
    const cat = c.categoria.trim();
    const sub = c.subcategoria ? c.subcategoria.trim() : "";
    const tipo = c.tipo || "Gasto";

    if (!relacion[cat]) relacion[cat] = [];
    if (sub && !relacion[cat].includes(sub)) relacion[cat].push(sub);
    tiposCat[cat] = tipo;
  });

  return {
    cuentas: [...new Set(cuentas)].sort(),
    mapaCuentas,
    beneficiarios: [...new Set(beneficiarios)].sort(),
    relacion,
    tiposCat,
  };
}

export async function obtenerSugerenciasBeneficiarioWeb(
  beneficiario,
  cuentaSeleccionada,
) {
  let query = supabase
    .from("transacciones")
    .select("fecha, cuenta, memo, monto_real, categoria, subcategoria, tipo")
    .eq("beneficiario", beneficiario)
    .in("tipo", ["Ingreso", "Gasto", "Egreso"])
    .order("fecha", { ascending: false })
    .order("id", { ascending: false })
    .limit(5);

  if (cuentaSeleccionada && cuentaSeleccionada.trim() !== "") {
    query = query.eq("cuenta", cuentaSeleccionada.trim());
  }

  const { data, error } = await query;
  if (error) throw error;
  if (!data || data.length === 0) return [];

  return data.map((f) => ({
    fecha: f.fecha,
    cuenta: f.cuenta,
    memo: f.memo || "",
    monto: Math.abs(parseFloat(f.monto_real) || 0),
    categoria: f.categoria || "",
    subcategoria: f.subcategoria || "",
    tipo: f.tipo === "Egreso" ? "Gasto" : f.tipo,
  }));
}

// --- 2. UTILIDADES DE CATÁLOGO E ID DE SERIE ---

async function generarNuevoIdWeb(prefijo) {
  const minId = parseInt(prefijo + "00000", 10);
  const maxId = parseInt(prefijo + "99999", 10);

  const { data, error } = await supabase
    .from("transacciones")
    .select("id_transaccion")
    .gte("id_transaccion", minId)
    .lte("id_transaccion", maxId)
    .order("id_transaccion", { ascending: false })
    .limit(1);

  if (error) throw error;
  if (data && data.length > 0) {
    return parseInt(data[0].id_transaccion, 10) + 1;
  }
  return parseInt(prefijo + "00001", 10);
}

async function asegurarBeneficiarioWeb(nombreBen) {
  if (!nombreBen || nombreBen.trim() === "") return;
  const { error } = await supabase
    .from("beneficiarios")
    .upsert(
      { nombre: nombreBen.trim(), estado: "Activo" },
      { onConflict: "nombre" },
    );
  if (error) console.warn("Aviso beneficiario:", error.message);
}

async function asegurarCategoriaWeb(cat, sub, tipo) {
  if (!cat || cat === "Transferencia" || cat === "Varios") return;
  let tipoNorm = tipo || "Gasto";
  if (tipoNorm.toLowerCase() === "egreso") tipoNorm = "Gasto";

  const { error } = await supabase.from("categorias").upsert(
    {
      categoria: cat.trim(),
      subcategoria: (sub || "").trim(),
      tipo: tipoNorm,
    },
    { onConflict: "categoria,subcategoria,tipo" },
  );
  if (error) console.warn("Aviso categoría:", error.message);
}

// --- 3. GUARDADO UNIVERSAL (SERIES 1, 2 Y 3) ---

export async function guardarMovimientoWeb(datosNuevos) {
  const cat =
    datosNuevos.categoria ||
    (datosNuevos.partidas && datosNuevos.partidas[0]
      ? datosNuevos.partidas[0].categoria
      : "");
  const sub =
    datosNuevos.subcategoria ||
    (datosNuevos.partidas && datosNuevos.partidas[0]
      ? datosNuevos.partidas[0].subcategoria
      : "");
  const tipo =
    datosNuevos.tipo ||
    (datosNuevos.cabecera ? datosNuevos.cabecera.tipoCabecera : "Gasto");

  await asegurarCategoriaWeb(cat, sub, tipo);

  const beneficiario = datosNuevos.cabecera
    ? datosNuevos.cabecera.beneficiario
    : datosNuevos.beneficiario;
  if (beneficiario && beneficiario.trim() !== "") {
    await asegurarBeneficiarioWeb(beneficiario.trim());
  }

  let serie = "1";
  if (datosNuevos.cabecera && datosNuevos.partidas) serie = "3";
  else if (datosNuevos.cuentaOrigen || datosNuevos.cuentaDestino) serie = "2";

  const esEdicion = Boolean(
    datosNuevos.id && String(datosNuevos.id).trim() !== "",
  );
  let idTx = esEdicion
    ? parseInt(datosNuevos.id, 10)
    : await generarNuevoIdWeb(serie);

  if (esEdicion) {
    const { error: errDel } = await supabase
      .from("transacciones")
      .delete()
      .eq("id_transaccion", idTx);
    if (errDel) throw errDel;
  }

  let lote = [];

  if (serie === "1") {
    const montoNum = parseFloat(datosNuevos.monto);
    const montoFinal =
      datosNuevos.tipo === "Gasto" ? -Math.abs(montoNum) : Math.abs(montoNum);
    lote.push({
      id_transaccion: idTx,
      fecha: datosNuevos.fecha,
      beneficiario: datosNuevos.beneficiario.trim(),
      cuenta: datosNuevos.cuenta,
      memo: datosNuevos.memo || "",
      monto_referencia: 0,
      moneda: datosNuevos.moneda || "COP",
      monto_real: montoFinal,
      categoria: datosNuevos.categoria || "",
      subcategoria: datosNuevos.subcategoria || "",
      tipo: datosNuevos.tipo,
      conciliado: false,
    });
  } else if (serie === "2") {
    lote.push(
      {
        id_transaccion: idTx,
        fecha: datosNuevos.fecha,
        beneficiario: "Transferencia a " + datosNuevos.cuentaDestino,
        cuenta: datosNuevos.cuentaOrigen,
        memo: datosNuevos.nota || "",
        monto_referencia: 0,
        moneda: datosNuevos.monedaOrigen,
        monto_real: -Math.abs(parseFloat(datosNuevos.montoOrigen)),
        categoria: "Transferencia",
        subcategoria: "a " + datosNuevos.cuentaDestino,
        tipo: "Transferencia",
        conciliado: false,
      },
      {
        id_transaccion: idTx,
        fecha: datosNuevos.fecha,
        beneficiario: "Transferencia desde " + datosNuevos.cuentaOrigen,
        cuenta: datosNuevos.cuentaDestino,
        memo: datosNuevos.nota || "",
        monto_referencia: 0,
        moneda: datosNuevos.monedaDestino,
        monto_real: Math.abs(parseFloat(datosNuevos.montoDestino)),
        categoria: "Transferencia",
        subcategoria: "desde " + datosNuevos.cuentaOrigen,
        tipo: "Transferencia",
        conciliado: false,
      },
    );
  } else if (serie === "3") {
    const cab = datosNuevos.cabecera;
    const partidas = datosNuevos.partidas;
    const esGastoTotal = partidas[0].tipo === "GASTO";

    // Fila Madre
    lote.push({
      id_transaccion: idTx,
      fecha: cab.fecha,
      beneficiario: cab.beneficiario,
      cuenta: cab.cuenta,
      memo: "Asiento Compuesto",
      monto_referencia: parseFloat(cab.montoReferencia) || 0,
      moneda: cab.moneda,
      monto_real: 0,
      categoria: "Varios",
      subcategoria: "Múltiple",
      tipo: esGastoTotal ? "Egreso" : "Ingreso",
      conciliado: false,
    });

    // Subpartidas
    for (const p of partidas) {
      const montoP = parseFloat(p.monto);
      const benFila =
        p.beneficiario && p.beneficiario.trim() !== ""
          ? p.beneficiario
          : cab.beneficiario;

      if (p.tipo === "TRANSFERENCIA") {
        lote.push({
          id_transaccion: idTx,
          fecha: cab.fecha,
          beneficiario: benFila,
          cuenta: cab.cuenta,
          memo: p.memo || "SUBPARTIDA",
          monto_referencia: 0,
          moneda: cab.moneda,
          monto_real: -Math.abs(montoP),
          categoria: "Transferencia",
          subcategoria: "a " + p.cuentaDestino,
          tipo: "Egreso",
          conciliado: false,
        });

        const montoEntrada =
          p.monedaDestino === cab.moneda
            ? montoP
            : parseFloat(p.montoDivisa) || montoP;
        lote.push({
          id_transaccion: idTx,
          fecha: cab.fecha,
          beneficiario: benFila,
          cuenta: p.cuentaDestino,
          memo: p.memo || "SUBPARTIDA",
          monto_referencia: 0,
          moneda: p.monedaDestino || cab.moneda,
          monto_real: Math.abs(montoEntrada),
          categoria: "Transferencia",
          subcategoria: "desde " + cab.cuenta,
          tipo: "Ingreso",
          conciliado: false,
        });
      } else {
        await asegurarCategoriaWeb(p.categoria, p.subcategoria, p.tipo);
        lote.push({
          id_transaccion: idTx,
          fecha: cab.fecha,
          beneficiario: benFila,
          cuenta: cab.cuenta,
          memo: p.memo || "SUBPARTIDA",
          monto_referencia: 0,
          moneda: cab.moneda,
          monto_real: p.tipo === "GASTO" ? -Math.abs(montoP) : Math.abs(montoP),
          categoria: p.categoria,
          subcategoria: p.subcategoria || "",
          tipo: p.tipo === "GASTO" ? "Egreso" : "Ingreso",
          conciliado: false,
        });
      }
    }
  }

  const { error } = await supabase.from("transacciones").insert(lote);
  if (error) throw error;

  return `✅ Transacción ${idTx} ${esEdicion ? "actualizada" : "registrada"} correctamente.`;
}

// --- 4. PLANTILLAS DE ASIENTOS COMPUESTOS ---

export async function obtenerPlantillasWeb() {
  const { data, error } = await supabase
    .from("plantillas_asientos")
    .select("nombre")
    .order("nombre", { ascending: true });
  if (error) throw error;
  return data.map((r) => r.nombre);
}

export async function cargarPlantillaWeb(nombre) {
  const { data, error } = await supabase
    .from("plantillas_asientos")
    .select("estructura")
    .eq("nombre", nombre)
    .single();
  if (error) throw error;
  return data ? data.estructura : null;
}

export async function guardarPlantillaWeb(nombre, estructura) {
  const { error } = await supabase.from("plantillas_asientos").upsert(
    {
      nombre: nombre.trim(),
      estructura,
      actualizado_en: new Date().toISOString(),
    },
    { onConflict: "nombre" },
  );
  if (error) throw error;
  return `✅ Plantilla '${nombre}' guardada con éxito.`;
}

export async function eliminarPlantillaWeb(nombre) {
  const { error } = await supabase
    .from("plantillas_asientos")
    .delete()
    .eq("nombre", nombre);
  if (error) throw error;
  return `🗑️ Plantilla '${nombre}' eliminada.`;
}
