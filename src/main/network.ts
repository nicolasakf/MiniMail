/**
 * Whether the computer has a network connection at all (Wi-Fi off, cable out, airplane mode),
 * as the operating system reports it. The app sets the real probe at startup; until then, and
 * in tests, the network counts as up.
 *
 * It says nothing about the internet being reachable: a captive portal or a broken DNS still
 * reads as online, and those failures are real ones that get reported.
 */
let probe: () => boolean = () => true;

/** Installs the function that asks the operating system (`net.isOnline` in Electron). */
export function setNetworkProbe(next: (() => boolean) | null): void {
  probe = next ?? (() => true);
}

export function isNetworkOnline(): boolean {
  return probe();
}
