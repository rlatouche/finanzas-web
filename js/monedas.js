import { supabase } from "./supabaseClient.js";

export async function obtenerMonedasWeb(soloActivas = false) {
  let query = supabase
    .from("monedas")
    .select(
      "codigo, nombre, simbolo, decimales, es_base, activa, mostrar_en_inicio",
    )
    .order("es_base", { ascending: false })
    .order("codigo", { ascending: true });

  if (soloActivas) {
    query = query.eq("activa", true);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function guardarMonedaWeb(moneda, esEdicion = false) {
  const codigo = (moneda.codigo || "").trim().toUpperCase();
  const nombre = (moneda.nombre || "").trim();
  const simbolo = (moneda.simbolo || "$").trim();
  const decimales = parseInt(moneda.decimales, 10);

  if (!codigo || codigo.length < 2 || codigo.length > 10) {
    throw new Error(
      "El código ISO debe tener entre 2 y 10 caracteres (ej. USD, CAD, BRL).",
    );
  }
  if (!nombre) {
    throw new Error("Debes escribir el nombre de la moneda.");
  }
  if (isNaN(decimales) || decimales < 0 || decimales > 6) {
    throw new Error("Los decimales deben estar entre 0 y 6.");
  }

  if (esEdicion) {
    const { error } = await supabase
      .from("monedas")
      .update({
        nombre,
        simbolo,
        decimales,
        mostrar_en_inicio: Boolean(moneda.mostrar_en_inicio),
        activa: Boolean(moneda.activa),
      })
      .eq("codigo", codigo);

    if (error) throw error;
    return `Moneda ${codigo} actualizada correctamente.`;
  } else {
    // Verificar si ya existe
    const { data: existente } = await supabase
      .from("monedas")
      .select("codigo")
      .eq("codigo", codigo)
      .maybeSingle();

    if (existente) {
      throw new Error(
        `La moneda ${codigo} ya existe. Usa el botón de editar para modificarla.`,
      );
    }

    const { error } = await supabase.from("monedas").insert({
      codigo,
      nombre,
      simbolo,
      decimales,
      es_base: false,
      activa: true,
      mostrar_en_inicio: Boolean(moneda.mostrar_en_inicio),
    });

    if (error) throw error;
    return `Moneda ${codigo} agregada correctamente.`;
  }
}

export async function cambiarEstadoMonedaWeb(codigo, nuevoEstado) {
  const cod = (codigo || "").trim().toUpperCase();

  if (!nuevoEstado) {
    // Verificar que no sea la moneda base ni tenga cuentas activas sin advertencia
    const { data: monInfo } = await supabase
      .from("monedas")
      .select("es_base")
      .eq("codigo", cod)
      .single();

    if (monInfo?.es_base) {
      throw new Error(`La moneda base (${cod}) no puede desactivarse.`);
    }
  }

  const { error } = await supabase
    .from("monedas")
    .update({ activa: Boolean(nuevoEstado) })
    .eq("codigo", cod);

  if (error) throw error;
  return `Moneda ${cod} ${nuevoEstado ? "activada" : "desactivada"}.`;
}
