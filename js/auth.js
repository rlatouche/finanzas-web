import { supabase } from "./supabaseClient.js";

export async function verificarSesion() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = "login.html";
    return null;
  }
  return session;
}

export async function iniciarSesion(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return data;
}

export async function cerrarSesion() {
  await supabase.auth.signOut();
  window.location.href = "login.html";
}
