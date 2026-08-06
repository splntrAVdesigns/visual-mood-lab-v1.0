// app/api/auth/[...nextauth]/route.ts
import { handlers } from "@/lib/auth/config";

export const { GET, POST } = handlers;
