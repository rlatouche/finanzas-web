const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const appEmail = process.env.APP_EMAIL;
const appPassword = process.env.APP_PASSWORD;

if (!supabaseUrl || !supabaseAnonKey || !appEmail || !appPassword) {
  console.error(
    "❌ Faltan variables de entorno (SUPABASE_URL, SUPABASE_ANON_KEY, APP_EMAIL o APP_PASSWORD).",
  );
  process.exit(1);
}

// Fecha actual en zona horaria de Bogotá (YYYY-MM-DD)
const fechaHoy = new Date().toLocaleDateString("en-CA", {
  timeZone: "America/Bogota",
});

async function iniciarSesionSupabase() {
  const resAuth = await fetch(
    `${supabaseUrl}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: supabaseAnonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: appEmail,
        password: appPassword,
      }),
    },
  );

  if (!resAuth.ok) {
    throw new Error(
      `Error autenticando usuario (${resAuth.status}): ${await resAuth.text()}`,
    );
  }

  const authData = await resAuth.json();
  return authData.access_token;
}

async function actualizarTasas() {
  console.log(`🔄 Iniciando sincronización de tasas para: ${fechaHoy}`);

  // 1. Autenticar con APP_EMAIL / APP_PASSWORD para usar rol 'authenticated' en RLS
  const accessToken = await iniciarSesionSupabase();

  const headersSupabase = {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates,return=minimal",
  };

  // 2. Obtener dinámicamente las monedas activas desde Supabase
  const resMon = await fetch(
    `${supabaseUrl}/rest/v1/monedas?select=codigo,es_base&activa=eq.true`,
    { headers: headersSupabase },
  );
  if (!resMon.ok) {
    throw new Error(
      `Error leyendo catálogo de monedas (${resMon.status}): ${await resMon.text()}`,
    );
  }

  const monedasDB = await resMon.json();
  const monedasActivas = (monedasDB || [])
    .filter((m) => !m.es_base)
    .map((m) => m.codigo.toUpperCase());

  console.log(`📋 Monedas activas a consultar: ${monedasActivas.join(", ")}`);

  // 3. Consultar API pública de tasas base COP (open.er-api.com)
  const resp = await fetch("https://open.er-api.com/v6/latest/COP");
  if (!resp.ok)
    throw new Error(`Error HTTP ${resp.status} al consultar API de tasas`);

  const json = await resp.json();
  if (json.result !== "success" || !json.rates) {
    throw new Error("Respuesta inválida de la API de tasas de cambio.");
  }

  // 4. Preparar registros para la tabla vertical (tasa_monedas)
  const filasVerticales = [
    { fecha: fechaHoy, moneda_codigo: "COP", tasa_a_cop: 1 },
  ];

  const tasasMapa = {};

  for (const codigo of monedasActivas) {
    const rateDesdeCOP = json.rates[codigo];

    if (rateDesdeCOP && rateDesdeCOP > 0) {
      const tasaACOP = Number((1 / rateDesdeCOP).toFixed(6));
      tasasMapa[codigo] = tasaACOP;
      filasVerticales.push({
        fecha: fechaHoy,
        moneda_codigo: codigo,
        tasa_a_cop: tasaACOP,
      });
    } else {
      console.warn(`⚠️ No se encontró tasa en la API para ${codigo}`);
    }
  }

  // 5. Upsert en la tabla vertical tasa_monedas
  const resVert = await fetch(
    `${supabaseUrl}/rest/v1/tasa_monedas?on_conflict=fecha,moneda_codigo`,
    {
      method: "POST",
      headers: headersSupabase,
      body: JSON.stringify(filasVerticales),
    },
  );
  if (!resVert.ok) {
    throw new Error(
      `Error guardando en tasa_monedas (${resVert.status}): ${await resVert.text()}`,
    );
  }
  console.log("✅ Tabla vertical tasa_monedas actualizada:", tasasMapa);
}

actualizarTasas().catch((err) => {
  console.error("❌ Fallo en actualizarTasas:", err);
  process.exit(1);
});
