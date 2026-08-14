"use server";

import { signIn, signOut } from "@/lib/auth";

export async function signInWithDiscord() {
  await signIn("discord");
}

export async function signOutOfDiscord() {
  await signOut();
}
