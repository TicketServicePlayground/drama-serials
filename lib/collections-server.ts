import "server-only";
import { cookies } from "next/headers";
import { FAVORITES_COOKIE, LIKES_COOKIE, parseList } from "./collections";

export async function readCollections(): Promise<{ favorites: string[]; likes: string[] }> {
  const jar = await cookies();
  return {
    favorites: parseList(jar.get(FAVORITES_COOKIE)?.value),
    likes: parseList(jar.get(LIKES_COOKIE)?.value),
  };
}
