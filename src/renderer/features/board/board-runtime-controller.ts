import type {
  BoardAppearance,
  BoardDocumentV3,
  BoardSettings,
} from "../../../shared/contracts";

export const DEFAULT_BOARD_APPEARANCE: BoardAppearance = {
  backgroundColor: "#202426",
  gridVisible: true,
  gridSize: 24,
};

export class BoardRuntimeController {
  guides: BoardDocumentV3["guides"];
  appearance: BoardAppearance;
  document: BoardDocumentV3;
  canvasMode: NonNullable<BoardDocumentV3["canvasMode"]>;
  sampling: NonNullable<BoardDocumentV3["sampling"]>;
  exportSettings: NonNullable<BoardDocumentV3["exportSettings"]>;
  windowMode: NonNullable<BoardDocumentV3["windowMode"]>;
  interactionPreset: BoardSettings["interactionPreset"] = "pureref";
  snapEnabled = true;
  bringToFrontOnSelect = false;

  constructor(document: BoardDocumentV3) {
    this.document = document;
    this.guides = document.guides;
    this.appearance = document.appearance ?? DEFAULT_BOARD_APPEARANCE;
    this.canvasMode = document.canvasMode ?? {
      locked: false,
      grayscale: false,
      gridStyle: "line",
    };
    this.sampling = document.sampling ?? "bilinear";
    this.exportSettings = document.exportSettings ?? {
      format: "png",
      embedAssets: false,
    };
    this.windowMode = document.windowMode ?? "normal";
  }

  syncDocument(document: BoardDocumentV3): void {
    this.document = document;
    this.guides = document.guides;
    this.appearance = document.appearance ?? DEFAULT_BOARD_APPEARANCE;
    this.canvasMode = document.canvasMode ?? {
      locked: false,
      grayscale: false,
      gridStyle: "line",
    };
    this.sampling = document.sampling ?? "bilinear";
    this.exportSettings = document.exportSettings ?? {
      format: "png",
      embedAssets: false,
    };
    this.windowMode = document.windowMode ?? "normal";
  }

  syncSettings(settings: BoardSettings): void {
    this.interactionPreset = settings.interactionPreset;
    this.snapEnabled = settings.snapEnabled;
    this.bringToFrontOnSelect = settings.bringToFrontOnSelect;
    if (settings.sampling) this.sampling = settings.sampling;
  }
}
