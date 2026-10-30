import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {};
export default nextConfig;

// Makes Cloudflare bindings (AI, VECTORIZE, secrets) available in `next dev`.
initOpenNextCloudflareForDev();
