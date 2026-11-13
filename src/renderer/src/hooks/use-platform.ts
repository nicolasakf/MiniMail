import { useEffect, useState } from "react";

export type PlatformOS = "macos" | "windows" | "linux" | "unknown";

/** Detects the OS family from the renderer's navigator. */
function detectPlatformOs(): PlatformOS {
  if (typeof navigator === "undefined") return "unknown";
  const userAgentData = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData;
  const platform = (
    userAgentData?.platform ||
    navigator.platform ||
    navigator.userAgent
  ).toLowerCase();

  if (platform.includes("mac")) return "macos";
  if (platform.includes("win")) return "windows";
  if (platform.includes("linux") || platform.includes("x11")) return "linux";
  return "unknown";
}

/** Returns the browser-detected OS family. */
export function usePlatformOs(): PlatformOS {
  const [platformOs, setPlatformOs] = useState<PlatformOS>("unknown");

  useEffect(() => {
    setPlatformOs(detectPlatformOs());
  }, []);

  return platformOs;
}

/** Returns true if the user is on a Mac. */
export function useIsMac(): boolean {
  return usePlatformOs() === "macos";
}
