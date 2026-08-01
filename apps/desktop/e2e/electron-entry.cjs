// E2E entry point: loads the built app unchanged, except that the native
// "pick a project folder" dialog is replaced with a stub returning
// PLANTAR_E2E_PICK_DIR. CDP cannot drive native OS dialogs, so stubbing at
// the Electron API boundary is the only way to automate that step without
// putting test hooks into the app itself.
const path = require("node:path");
const { dialog } = require("electron");

const pickDir = process.env.PLANTAR_E2E_PICK_DIR;
if (pickDir) {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [pickDir] });
}

require(path.join(__dirname, "..", "out", "main", "index.js"));
