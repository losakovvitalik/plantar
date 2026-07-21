import { Menu, Tray, app, nativeImage } from "electron";
import { t } from "./i18n";

/**
 * Tray icon that keeps Plantar alive with the window closed — the background
 * monitor needs a living main process on every platform. The menu is minimal:
 * open the window, quit the app.
 *
 * The icons are tiny sprout PNGs: macOS gets a black template image (the system
 * recolors it for the menu bar), Windows/Linux get a green one. Tray look on
 * Linux varies by desktop environment — best effort.
 *
 * They are embedded as base64 so the packaged app needs no extra resource
 * files. The editable sources are build/tray/*.png (16px + @2x), byte-identical
 * to the constants below: after editing an icon, re-embed it with
 * `base64 -i build/tray/tray.png`.
 */

/** build/tray/tray-template.png */
const BLACK_16 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAgElEQVR42mNgGCzAgYGBYT8DA8N6BgaGBDzqEqBq9kP1wAFI4D8SPs/AwGCAJG8AFUNWsx/ZgH40SRB+z8DAIADF77HI9yMbAFJ0H4ui+VCMLn4fqgcFKGBx5nsstp+HqsUbUPvRwgXGTyA1dmAGkA1GDaCCAbB0QDYwQMsTGAAAYV1BXeIY5PoAAAAASUVORK5CYII=";
/** build/tray/tray-template@2x.png */
const BLACK_32 =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA1UlEQVR42u1XUQ3EIAytBCQgZRKQgAQk4AAJSEHCSZgEJOz20SU9AqwwcpdL+pKXLBnv9W20LAMQCD6hAMCdFx65LfDciJ/DGlVoAMgAcBTMKFaDD+I7from8pXFpdAwiptGYUo/E+Bi6BQPTA/fSn4wGSv6OKBvvsl9wMQSnR3Q7XcdyzXK2GyKseeUt5PlBszcxHoWuA35Qk433tNx4m6VeXIyhskgGbVq1RFtcdRSY+ToPbuqcA9lgK9DAkgACSABJIAESKR4+kUAjZ/e2PrR+Au8ASAkBhDQLY4UAAAAAElFTkSuQmCC";
/** build/tray/tray.png */
const GREEN_16 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAjklEQVR42mPwX5HPQAlmoJYBDv4r8vf7r8hf778iPwGPhgSomv1QPXADQAL/kfB5/xX5BkgaDaBiyGr2IxvQjyYJwu/9V+QLQPF7LPL9yAaAFN3Homg+FKOL34fqQQlEBSzOfI/F9vNQtThjIQHqv/1o/t2PLYAJRRPMALLTwagBVDAAlg7INsAALU9gYABPBadsxwcfIgAAAABJRU5ErkJggg==";
/** build/tray/tray@2x.png */
const GREEN_32 =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA7UlEQVR42u2X4QnDIBCFHcERMoob6AhuoCNkg4zgX7fICB0hIzhC28AVDtH0zoamhfvxIBDfvY/kPFHZHNSVUgLwawDa5hCfzzPInBBiUL0IGU2AyeZQbA73SgXMmhGqwdOrN7UA5sbi2ugI4a4TjDWPALy0HIQvxBpNAEc070qN8MTwu14TbowiHvk8w7cd7QLDKFSg2TThn2OZd3MgMorFgfWkQURtyBuI1XjUSeiYn3Zo+1IGyjIIUsCrzzgLNHT6vtXWzpbD7zx1cn4y42uAr5+GAiAAAiAAAiAAKwpfrwCY4OhN+KLxd3fDB5Dmnltc5gg6AAAAAElFTkSuQmCC";

let tray: Tray | null = null;
let openWindow: (() => void) | null = null;

function trayIcon(): Electron.NativeImage {
  if (process.platform === "darwin") {
    const icon = nativeImage.createFromDataURL(`data:image/png;base64,${BLACK_16}`);
    icon.addRepresentation({
      scaleFactor: 2,
      dataURL: `data:image/png;base64,${BLACK_32}`,
    });
    icon.setTemplateImage(true);
    return icon;
  }
  const icon = nativeImage.createFromDataURL(`data:image/png;base64,${GREEN_16}`);
  icon.addRepresentation({
    scaleFactor: 2,
    dataURL: `data:image/png;base64,${GREEN_32}`,
  });
  return icon;
}

function buildMenu(): Menu {
  return Menu.buildFromTemplate([
    { label: t("trayOpen"), click: () => openWindow?.() },
    { type: "separator" },
    { label: t("trayQuit"), click: () => app.quit() },
  ]);
}

export function createAppTray(onOpenWindow: () => void): void {
  openWindow = onOpenWindow;
  tray = new Tray(trayIcon());
  tray.setToolTip("Plantar");
  tray.setContextMenu(buildMenu());
  // On Windows a plain click does not open the context menu — open the window
  if (process.platform === "win32") tray.on("click", () => openWindow?.());
}

/** Re-applies menu labels after an interface language change */
export function refreshTrayMenu(): void {
  tray?.setContextMenu(buildMenu());
}

/** Removes the icon on quit — Windows is prone to leaving dead tray icons */
export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
