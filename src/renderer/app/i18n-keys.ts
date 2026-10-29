/**
 * MessageKey 联合类型（自动维护）：与 i18n-catalogs/*.ts 的 en 基 catalog 键集合一致。
 * 拆到独立文件，避免 i18n 门面超过架构测试的 600 行上限。
 */

export type MessageKey =
  | "common.fileFilterAll"

  | "common.fileFilterImages"

  | "common.fileFilterVideos"

























  | "app.createBoardConfirm"

  | "app.deleteBoardConfirm"

  | "app.loadingWorkspace"


  | "app.newBoardDescription"

  | "app.openBackupDirectory"

  | "app.operationFailed"

  | "app.quit"

  | "app.degradedBanner"



  | "app.safeModeTitle"

  | "app.safeModeDescription"

  | "app.safeModeRestore"

  | "app.safeModeNewDatabase"

  | "app.safeModeNoBackups"

  | "app.schemaTooNewTitle"

  | "app.schemaTooNewDescription"

  | "app.recoveryBackupDirectory"

  | "app.recoveryDatabaseFile"

  | "app.recoveryDescription"

  | "app.recoveryTitle"

  | "app.workspaceInitFailed"

  | "app.installComplete.eyebrow"

  | "app.installComplete.title"

  | "app.installComplete.description"

  | "app.installComplete.open"

  | "app.installComplete.footnote"

  | "audio.loadingWaveform"

  | "audio.metaAuthor"

  | "audio.metaFormat"

  | "audio.metaLength"

  | "audio.metaName"


  | "board.addArrow"

  | "board.addChecklist"

  | "board.addGuideX"

  | "board.addGuideY"

  | "board.addNote"

  | "board.addRectangle"

  | "board.addRectangleObject"

  | "board.addText"

  | "board.alignBottom"

  | "board.alignCenterX"

  | "board.alignCenterY"

  | "board.alignLeft"

  | "board.alignRight"

  | "board.alignTop"

  | "board.appearanceBackgroundLabel"

  | "board.appearanceGridLabel"

  | "board.appearanceHexError"

  | "board.appearanceTitle"

  | "board.apply"

  | "board.cancel"

  | "board.arrangeApply"

  | "board.arrangeByAdded"

  | "board.arrangeByLayer"

  | "board.arrangeByName"

  | "board.arrangeByPath"

  | "board.arrangeCompact"

  | "board.arrangeCompactSelection"

  | "board.arrangeGap"

  | "board.arrangeSortKey"

  | "board.arrangeRandom"

  | "board.arrangeReverse"

  | "board.arrangeSettings"

  | "board.arrangeStack"

  | "board.boardAssetDefaultTitle"

  | "board.canvasGrayscaleWhole"

  | "board.checklistItemsLabel"

  | "board.checklistNewDescription"

  | "board.checklistNewTitle"

  | "board.clickThroughNotice"

  | "board.collapseToolbar"

  | "board.close3DPreview"

  | "board.closeArrangeSettings"

  | "board.closeDrawingSettings"

  | "board.closeInspector"

  | "board.closeLayers"

  | "board.closePreview"

  | "board.closeWindow"

  | "board.commandPaletteCount"

  | "board.commandPaletteEmpty"

  | "board.commandPaletteEmptyHint"

  | "board.commandPaletteExecute"

  | "board.commandPaletteLabel"

  | "board.commandPalettePlaceholder"

  | "board.commandPaletteRecent"

  | "board.commandPaletteSearchLabel"

  | "board.commandPaletteSelect"

  | "board.commandPaletteShortcutSettings"

  | "board.commandPaletteTitle"

  | "board.commentAdd"

  | "board.commentAddShort"

  | "board.commentDescription"

  | "board.commentEdit"

  | "board.commentEditShort"

  | "board.commentLabel"

  | "board.commentObjectLabel"

  | "board.commentPlaceholder"

  | "board.commentSave"

  | "board.conflictCopyName"

  | "board.conflictDescription"

  | "board.conflictSaveCopy"

  | "board.conflictTitle"

  | "board.copyClipboard"

  | "board.crop"

  | "board.cropImage"

  | "board.currentBoard"

  | "board.delete"

  | "board.deleteBoard"

  | "board.deleteBoardConfirm"

  | "board.deleteBoardDescription"

  | "board.distributeX"

  | "board.distributeY"

  | "board.drawEllipse"

  | "board.drawingColor"

  | "board.drawingDashed"

  | "board.drawingLineStyle"

  | "board.drawingNameEllipse"

  | "board.drawingNameLine"

  | "board.drawingNamePencil"

  | "board.drawingNameRectangle"

  | "board.drawingSettings"

  | "board.drawingShiftHint"

  | "board.drawingSolid"

  | "board.drawingToolEllipse"

  | "board.drawingToolLine"

  | "board.drawingToolPencil"

  | "board.drawingToolRectangle"

  | "board.drawingTools"

  | "board.drawingTypeGroup"

  | "board.drawingWidth"

  | "board.drawLine"

  | "board.drawRectangle"

  | "board.dropFolderUnsupported"

  | "board.dropLimited"

  | "board.dropPlaced"

  | "board.importOptimized"

  | "board.duplicate"

  | "board.editContent"

  | "board.editNote"

  | "board.emptyHint"

  | "board.enableDrawing"

  | "board.eraser"

  | "board.exitClickThroughNotice"

  | "board.exitDrawing"

  | "board.exitFocus"

  | "board.expandToolbar"

  | "board.exportPngSelection"

  | "board.exportPngSaved"

  | "board.exportPngFailed"

  | "board.fitAll"

  | "board.fitSelection"

  | "board.flipH"

  | "board.flipV"

  | "board.focus"











  | "board.focusSelection"


  | "board.gifPause"

  | "board.gifPlay"

  | "board.gridStyleCycle"

  | "board.group"

  | "board.groupArrange"

  | "board.groupBoard"

  | "board.groupDefaultName"

  | "board.groupEdit"

  | "board.groupExport"

  | "board.groupImage"

  | "board.groupInsert"

  | "board.groupObject"

  | "board.groupSettings"

  | "board.groupTools"

  | "board.groupTransform"

  | "board.groupView"

  | "board.groupWindow"

  | "board.guideHorizontal"

  | "board.guideVertical"

  | "board.hideGrid"

  | "board.hudCanvasCoords"

  | "board.hudColorCopied"

  | "board.hudCropHint"

  | "board.hudCropPanHint"

  | "board.hudCropZoomHint"

  | "board.hudCropZoomPercent"

  | "board.hudFlipHint"

  | "board.hudImageCoords"

  | "board.hudOpacity"

  | "board.hudPixelReadFailed"

  | "board.hudRotate"

  | "board.hudScaleHint"

  | "board.hudZoomHint"

  | "board.hudZoomPercent"

  | "board.imageDefaultName"

  | "board.importFiles"

  | "board.importFilesTitle"

  | "board.importPlaced"

  | "board.importUnsupported"

  | "board.inspectorEmpty"

  | "board.inspectorHeight"

  | "board.inspectorMultiSelection"

  | "board.inspectorOpacity"

  | "board.inspectorRotation"

  | "board.inspectorTitle"
  | "board.inspectorSourceSize"
  | "board.inspectorSourceHint"

  | "board.inspectorWidth"

  | "board.layerDragHint"

  | "board.layerHide"

  | "board.layerLocateSelect"

  | "board.layerLock"

  | "board.layerMoreActions"

  | "board.layerMoveDown"

  | "board.layerMoveUp"

  | "board.layerName"

  | "board.layerSearch"

  | "board.layerShow"

  | "board.layersTitle"

  | "board.layerUnlock"

  | "board.layerUnparentDrop"

  | "board.loading"

  | "board.locateInIndex"

  | "board.locateAssetMissing"

  | "board.locateFailed"

  | "board.lockCanvasWhole"

  | "board.lockUnlock"

  | "board.moveBottom"

  | "board.moveDownOne"

  | "board.moveTop"

  | "board.moveUpOne"

  | "board.normalizeHeight"

  | "board.normalizeWidth"

  | "board.noteChecklistLabel"

  | "board.noteContentLabel"

  | "board.noteEditContentLabel"

  | "board.noteEditTitle"

  | "board.noteLinkLabel"

  | "board.noteLinkOptionalLabel"

  | "board.noteNewDescription"

  | "board.noteNewTitle"

  | "board.noteWidthLabel"

  | "board.objectDefaultName"

  | "board.objectIndexName"

  | "board.opacity"

  | "board.opacityLabel"

  | "board.opacityTitle"

  | "board.openCommandPalette"

  | "board.openInspector"

  | "board.openLayers"

  | "board.parent"

  | "board.parentWithHint"

  | "board.paste"

  | "board.pasteObject"

  | "board.redo"

  | "board.relink"

  | "board.relinkCandidateLabel"

  | "board.relinkConfirm"

  | "board.relinkDescription"

  | "board.relinkPickTitle"

  | "board.relinkTitle"

  | "board.renameBoard"

  | "board.renameBoardTitle"

  | "board.renameLayer"

  | "board.resetCrop"

  | "board.resetTransform"

  | "board.restoreCanvasColor"

  | "board.rotate90"

  | "board.sampleColorTitle"

  | "board.colorCanvasPoint"

  | "board.colorFieldAlpha"

  | "board.colorFieldHex"

  | "board.colorFieldHsl"

  | "board.colorFieldRgb"

  | "board.colorHue"

  | "board.colorPlane"

  | "board.colorSampleCopied"

  | "board.colorSampleCopyHint"

  | "board.colorSampleTitle"

  | "board.colorSourceCanvas"

  | "board.colorSourcePoint"

  | "board.colorSourcePointUnavailable"

  | "board.colorSourceSize"

  | "board.colorDifferenceHint"

  | "board.samplingNotice"

  | "board.samplingReadFailed"

  | "board.saved"

  | "board.saveName"

  | "board.saving"

  | "board.shortcutClear"

  | "board.shortcutComment"

  | "board.shortcutConflict"

  | "board.shortcutDefault"

  | "board.shortcutGroupInterface"

  | "board.shortcutHint"

  | "board.shortcutModify"

  | "board.shortcutRecording"

  | "board.shortcutReserved"

  | "board.shortcutResetAll"

  | "board.shortcutResetTransform"

  | "board.shortcuts"

  | "board.shortcutSettingsClose"

  | "board.shortcutSettingsDescription"

  | "board.shortcutSettingsEyebrow"

  | "board.shortcutSettingsTitle"

  | "board.shortcutToggleGrid"

  | "board.shortcutUnset"

  | "board.showGrid"

  | "board.switchBoard"

  | "board.toggleLock"

  | "board.toolbarLabel"

  | "board.toolbarMore"

  | "board.toolSelect"

  | "board.undo"

  | "board.undoStroke"

  | "board.ungroup"

  | "board.uniformArea"

  | "board.uniformScale"

  | "board.unlockCanvas"

  | "board.unparent"

  | "board.windowAlwaysBottom"

  | "board.windowLocked"

  | "board.windowModeFailed"

  | "board.windowNormal"

  | "board.windowOverlay"

  | "board.zoom100"

  | "board.zoomFit"

  | "board.zoomIn"

  | "board.zoomOut"

  | "boards.createConfirm"

  | "boards.nameLabel"

  | "boards.new"

  | "boards.unavailable"

  | "browser.closeTabNamed"

  | "browser.empty"


  | "browser.tab.new"

  | "browser.tabList"

  | "capture.cancel"

  | "capture.error"

  | "capture.instructions"

  | "capture.loading"

  | "capture.passiveHint"

  | "capture.save"
  | "capture.saved"
  | "capture.unavailable"
  | "capture.saving"

  | "collections.acknowledge"

  | "collections.addFailed"

  | "collections.addFailedDesc"

  | "collections.addFiles"

  | "collections.addFilesNamed"


  | "collections.childNameLabel"

  | "collections.collapse"

  | "collections.containsScope"

  | "collections.continue"

  | "collections.create"

  | "collections.createConfirm"

  | "collections.createFromFiles"

  | "collections.default"

  | "collections.delete"

  | "collections.deleteConfirm"

  | "collections.deleteNamed"
  | "collections.dropActive"

  | "collections.empty"

  | "collections.emptyHint"

  | "collections.expand"

  | "collections.export"


  | "collections.exporting"

  | "collections.exportNamed"


  | "collections.exportConflictTitle"

  | "collections.exportConflictDescription"

  | "collections.exportConflictStrategy"

  | "collections.exportConflictRename"

  | "collections.exportConflictReplace"

  | "collections.exportConflictSkip"

  | "collections.fingerprintChanged"

  | "collections.fingerprintChangedDesc"

  | "collections.itemCount"

  | "collections.menu"

  | "collections.moveDown"

  | "collections.moveUp"

  | "collections.nameLabel"

  | "collections.newChild"

  | "collections.openInNewTab"

  | "collections.openSource"

  | "collections.paneTitle"

  | "collections.pickFiles"

  | "collections.recursiveDelete"

  | "collections.relink"

  | "collections.removeItem"

  | "collections.rename"

  | "collections.resolve"

  | "collections.resolving"

  | "collections.save"

  | "collections.scopeChildrenItems"

  | "collections.scopeItems"

  | "collections.skippedDirectories"


  | "collections.state.ambiguous"

  | "collections.state.missing"

  | "collections.state.offline"

  | "collections.state.resolved"

  | "collections.webCaptures"
  | "collections.deleteCaptureFile"
  | "collections.deleteFile"
  | "collections.deleteFileDesc"
  | "collections.deleteSelectedFiles"
  | "collections.deleteSelectedFilesDesc"
  | "collections.adopt"
  | "collections.adoptNone"
  | "collections.adoptPickTitle"
  | "collections.adoptFailedCount"
  | "collections.filesShort"
  | "collections.attentionShort"
  | "collections.statusSummary"
  | "collections.all"
  | "collections.searchPlaceholder"
  | "collections.sortBy"
  | "collections.sortStatus"
  | "collections.sortAdded"
  | "collections.batchToolbar"
  | "collections.selectedShort"
  | "collections.noMatches"
  | "collections.noMatchesHint"
  | "collections.clearFilters"
  | "collections.breadcrumb"
  | "collections.clearSearch"

  | "crop.apply"

  | "crop.cancel"

  | "crop.named"

  | "crop.reset"

  | "crop.title"

  | "dialogs.browse"

  | "dialogs.cancel"

  | "dialogs.close"

  | "dialogs.confirm"

  | "dialogs.invalidNumber"

  | "dialogs.max"

  | "dialogs.maxLength"

  | "dialogs.min"

  | "dialogs.pickDirectoryFor"

  | "dialogs.processing"

  | "dialogs.required"

  | "directory.actionChangeExtension"

  | "directory.actionCompress"

  | "directory.actionConvert"

  | "directory.actionExportCsv"

  | "directory.actionExportFolder"

  | "directory.actionMergeImages"

  | "directory.actionVideoToGif"

  | "directory.actionWebp"

  | "directory.addToBoard"

  | "directory.all"

  | "directory.assetMetadata"


  | "directory.back"

  | "directory.backgroundTasks"

  | "directory.backupAndDownscale"

  | "directory.backupOverwriteDescription"

  | "directory.backupOverwriteTitle"

  | "directory.batchCancelled"

  | "directory.batchCompleted"

  | "directory.batchFailed"

  | "directory.batchProcessing"

  | "directory.batchTagDescription"

  | "directory.cancelBatch"


  | "directory.cancelTask"

  | "directory.clearClipboard"

  | "directory.clearSelection"

  | "directory.clipboardCopy"

  | "directory.clipboardCount"

  | "directory.clipboardCut"

  | "directory.collapse"

  | "directory.collapseDrive"

  | "directory.collapseTasksPanel"

  | "directory.conflictDescription"

  | "directory.conflictOverwritePrompt"

  | "directory.conflictRename"

  | "directory.conflictReplace"

  | "directory.conflictSkip"

  | "directory.conflictStrategy"

  | "directory.conflictTitle"

  | "directory.continue"

  | "directory.convertPreset"

  | "directory.copyFailed"

  | "directory.copyFailedCount"

  | "directory.copySelectedPaths"

  | "directory.copyTo"

  | "directory.copyToClipboard"

  | "directory.create"

  | "directory.currentOnly"

  | "directory.cut"

  | "directory.deleteNamed"
  | "directory.authorizeWrite"

  | "directory.deleteSelectedCount"

  | "directory.directoryLabel"

  | "directory.downscale"

  | "directory.downscaleEllipsis"

  | "directory.downscaleMode"

  | "directory.downscaleModeBackup"

  | "directory.downscaleModeSubdirectory"

  | "directory.downscaleModeSuffix"

  | "directory.empty"

  | "directory.emptyHint"

  | "directory.expand"

  | "directory.expandDrive"

  | "directory.export"

  | "directory.exportFrames"

  | "directory.exportMp4"

  | "directory.exportMp4Failed"

  | "directory.exportMp4NoPresets"

  | "directory.exportSequenceToMp4"

  | "directory.exportUtf8PathList"

  | "directory.extensionCount"

  | "directory.failedCount"

  | "directory.failedToUpdateAsset"

  | "directory.favorited"

  | "directory.favoriteDir"

  | "directory.favoritedNamed"

  | "directory.favoriteHint"

  | "directory.favoriteNamed"

  | "directory.favoritesOnly"

  | "directory.favoritesOnlyEmpty"

  | "directory.favoritesOnlyEmptyHint"

  | "directory.fileFallback"


  | "directory.filesCount"

  | "directory.flattenWarning"

  | "directory.folder"

  | "directory.folderName"

  | "directory.folders"

  | "directory.foldersCount"

  | "directory.formatFilter"

  | "directory.forward"




  | "directory.generated"

  | "directory.gifFromVideos"

  | "directory.gifWorkbench"

  | "directory.gridView"

  | "directory.includeAllDepths"

  | "directory.includeDepth"


  | "directory.itemCount"

  | "directory.itemsSelected"

  | "directory.listView"

  | "directory.loading"

  | "directory.loadingDrives"

  | "directory.local"

  | "directory.maxDimensionLabel"

  | "directory.mergeSequences"

  | "directory.moveFailed"

  | "directory.moveFailedCount"

  | "directory.moveTo"

  | "directory.mp4Exported"

  | "directory.newFolder"

  | "directory.newTab"

  | "directory.pathInput"


  | "directory.noActionableAssets"

  | "directory.noBackgroundTasks"

  | "directory.noDrives"

  | "directory.noPermissionDirectories"

  | "directory.open"

  | "directory.openDirectory"


  | "directory.openTasksPanel"

  | "directory.operationFailed"

  | "directory.locatedNamed"

  | "directory.locateNotFound"

  | "directory.locateFailed"

  | "directory.other"

  | "directory.outputDirectory"

  | "directory.overwrite"

  | "directory.pasteFailedCount"

  | "directory.pasteToCurrent"

  | "directory.pickCopyTarget"

  | "directory.pickMoveTarget"


  | "directory.previewSettings"

  | "directory.ratedNamed"

  | "directory.ratingClearedNamed"

  | "directory.ratingStars"

  | "directory.refresh"

  | "directory.removeFromList"

  | "directory.retryFailedItems"

  | "directory.revealInFolder"

  | "directory.runScript"

  | "directory.scriptExitCode"

  | "directory.scriptHashChanged"

  | "directory.scriptHashChangedDescription"

  | "directory.scriptNoOutput"

  | "directory.scriptRunFailed"

  | "directory.scriptRunFailedTitle"

  | "directory.scriptTimedOut"

  | "directory.searchComplete"

  | "directory.searchCurrent"

  | "directory.searchScope"

  | "directory.searchScopeAllMounts"

  | "directory.searchScopeDirectory"

  | "directory.searchScopeMount"

  | "directory.searchEmpty"

  | "directory.searchEmptyHint"

  | "directory.searchFailedDirectories"

  | "directory.searchPlaceholder"




  | "directory.skip"

  | "directory.sortBy"

  | "directory.sortModified"

  | "directory.sortName"

  | "directory.sortSize"

  | "directory.start"

  | "directory.statePreparing"

  | "directory.stateReviewing"

  | "directory.subdirectories"

  | "directory.tagDescription"

  | "directory.tagsLabel"

  | "directory.tasks"

  | "directory.transcodeToMp4"

  | "directory.trashBatchDescription"

  | "directory.trashDescription"

  | "directory.unfavorite"

  | "directory.unfavoritedNamed"

  | "directory.unfavoriteNamed"




  | "directory.untitled"


  | "directory.viewMode"

  | "directory.viewOptions"



  | "directory.zoom"









  | "font.glyphCount"

  | "font.loadFailed"

  | "font.loading"

  | "font.variableAxes"

  | "gif.about"

  | "gif.addVideos"

  | "gif.cancelExport"

  | "gif.clipCount"

  | "gif.clipDuration"

  | "gif.closeStudio"

  | "gif.colorCount"

  | "gif.colors"


  | "gif.dither"

  | "gif.ditherOff"

  | "gif.ditherSierra"

  | "gif.dropZone"

  | "gif.durationSeconds"

  | "gif.estimatedSize"

  | "gif.estimateHint"

  | "gif.exported"

  | "gif.exportFailed"

  | "gif.exportFrame"

  | "gif.faster"

  | "gif.fileName"

  | "gif.generate"

  | "gif.inPoint"

  | "gif.maxWidth"

  | "gif.moveDown"

  | "gif.moveUp"

  | "gif.outPoint"

  | "gif.pickClips"

  | "gif.pickOutputDir"

  | "gif.readFailed"

  | "gif.reading"

  | "gif.removeClip"

  | "gif.showFile"

  | "gif.slower"

  | "gif.studio"

  | "gif.studioHint"

  | "gif.timeline"

  | "gif.videoFilter"

  | "hdr.addOcioConfig"

  | "hdr.addOcioConfigTitle"

  | "hdr.adjustExposure"

  | "hdr.alt"

  | "hdr.auto"

  | "hdr.channels"


  | "hdr.colorManagement"

  | "hdr.composite"

  | "hdr.exportChannelFailed"

  | "hdr.exportChannelHint"

  | "hdr.exportChannelTitle"

  | "hdr.exportCurrentChannel"

  | "hdr.exporting"


  | "hdr.exposureValue"

  | "hdr.failed"

  | "hdr.generating"

  | "hdr.layers"

  | "hdr.layersSelect"


  | "hdr.noExtraLayers"

  | "hdr.ocioColorManagement"

  | "hdr.ocioLoadFailed"

  | "hdr.ocioLoadFailedDetail"

  | "hdr.ocioMenu"

  | "hdr.resetExposure"

  | "hdr.retry"

  | "hdr.revealExported"

  | "hdr.toolbar"

  | "hdr.unknownError"

  | "hdr.waiting"

  | "imageReview.checker"

  | "imageReview.copied"

  | "imageReview.copy"


  | "imageReview.error"

  | "imageReview.eyedrop"

  | "imageReview.fit"

  | "imageReview.fitShort"

  | "imageReview.layerNote"

  | "imageReview.layers"

  | "imageReview.noLayers"




  | "imageReview.rotate"




  | "mediaInfo.animationCount"

  | "mediaInfo.audioTracks"

  | "mediaInfo.audioTracksCodec"

  | "mediaInfo.audioTracksValue"

  | "mediaInfo.bitDepth"

  | "mediaInfo.bitRate"

  | "mediaInfo.channels"

  | "mediaInfo.charCount"

  | "mediaInfo.chromaticities"

  | "mediaInfo.codec"

  | "mediaInfo.colorPrimaries"

  | "mediaInfo.colorRange"

  | "mediaInfo.colorSpace"

  | "mediaInfo.colorTransfer"

  | "mediaInfo.compression"

  | "mediaInfo.container"

  | "mediaInfo.coverArt"

  | "mediaInfo.dataWindow"

  | "mediaInfo.displayAspectRatio"

  | "mediaInfo.displayWindow"

  | "mediaInfo.duration"

  | "mediaInfo.family"

  | "mediaInfo.firstLine"

  | "mediaInfo.flavor"

  | "mediaInfo.frameRate"

  | "mediaInfo.glyphCount"

  | "mediaInfo.has"

  | "mediaInfo.italic"

  | "mediaInfo.level"

  | "mediaInfo.lineCount"

  | "mediaInfo.materialCount"

  | "mediaInfo.meshCount"

  | "mediaInfo.no"

  | "mediaInfo.none"

  | "mediaInfo.normals"

  | "mediaInfo.note"

  | "mediaInfo.pixelAspectRatio"

  | "mediaInfo.pixelFormat"

  | "mediaInfo.profile"

  | "mediaInfo.resolution"

  | "mediaInfo.sampleRate"

  | "mediaInfo.size"

  | "mediaInfo.style"

  | "mediaInfo.text"

  | "mediaInfo.textureCount"

  | "mediaInfo.timeBase"

  | "mediaInfo.title"

  | "mediaInfo.triangleCount"

  | "mediaInfo.variableAxes"

  | "mediaInfo.vertexColors"

  | "mediaInfo.vertexCount"

  | "mediaInfo.weight"

  | "mediaInfo.yes"

  | "model.camera"

  | "model.cameraCount"


  | "model.displayMode"

  | "model.previewFailed"

  | "model.resetView"


  | "model.saved"

  | "model.saveFailed"

  | "model.saveView"

  | "model.saving"


  | "model.setThumbnail"

  | "model.settingThumbnail"



  | "model.solid"


  | "model.thumbnailFailed"

  | "model.thumbnailUpdated"

  | "model.uvCheck"

  | "model.viewActions"

  | "model.viewFront"

  | "model.viewLeft"

  | "model.viewRight"

  | "model.viewTop"

  | "model.wireframe"

  | "notes.addAssetNote"

  | "notes.addAtFrame"

  | "notes.addAtTime"


  | "notes.asset"

  | "notes.draft"

  | "notes.edit"

  | "notes.framePosition"

  | "notes.jumpTo"

  | "notes.jumpToFrame"

  | "notes.panel"

  | "notes.saveNote"

  | "panorama.error"

  | "panorama.flat"

  | "panorama.viewer"

  | "presentation.exit"

  | "preview.addLut"


  | "preview.auto"

  | "preview.clearColors"

  | "preview.clearSampled"



  | "preview.close"


  | "preview.closeTool"

  | "preview.collapseColors"

  | "preview.colorBar"

  | "preview.colorExtractFailed"

  | "preview.colorToolbarLabel"

  | "preview.copyColor"

  | "preview.copyPath"

  | "preview.displayModeGroup"


  | "preview.emptyHint"

  | "preview.error"

  | "preview.exitFocus"

  | "preview.exitFullscreen"

  | "preview.expandColors"

  | "preview.exportFrames"

  | "preview.exportGif"

  | "preview.extensionFile"

  | "preview.extractColors"

  | "preview.eyedropUnsupported"

  | "preview.fit"

  | "preview.fixedPaletteLabel"

  | "preview.focus"

  | "preview.frameLabel"

  | "preview.fullscreen"

  | "preview.captureThumbnail"

  | "preview.thumbnailMoreActions"

  | "preview.pickThumbnailFile"

  | "preview.settingThumbnail"

  | "preview.thumbnailUpdated"

  | "preview.thumbnailFailed"

  | "preview.generating"

  | "preview.grid"

  | "preview.importLut"


  | "preview.loop"

  | "preview.lut"

  | "preview.lutMenu"

  | "preview.matchApply"

  | "preview.matchApplied"

  | "preview.matchChangeReference"

  | "preview.matchControlsInvalid"

  | "preview.matchContrast"

  | "preview.matchDivider"

  | "preview.matchExport"

  | "preview.matchExported"

  | "preview.matchHint"

  | "preview.matchHue"

  | "preview.matchHueCoolBlue"

  | "preview.matchHueCoolCyan"

  | "preview.matchHueCoolViolet"

  | "preview.matchHueMagenta"

  | "preview.matchHueNaturalGreen"

  | "preview.matchHueNeutral"

  | "preview.matchHueRose"

  | "preview.matchHueWarmOrange"

  | "preview.matchHueWarmRed"

  | "preview.matchHueWarmYellow"

  | "preview.matchHueYellowGreen"

  | "preview.matchHighlights"

  | "preview.matchLutMissing"

  | "preview.matchMedian"

  | "preview.matchMidtones"

  | "preview.matchOpen"
| "preview.matchClose"
| "preview.matchWorkspace"
| "preview.matchWorkspaceRec709"
| "preview.matchWorkspaceDwg"
| "preview.matchWorkspaceSlog3"
| "preview.matchGamut"
| "preview.matchGamutCine"
| "preview.matchGamutFull"
| "preview.matchRange"
| "preview.matchRangeFull"
| "preview.matchRangeVideo"
| "preview.matchExportPng"
| "preview.matchPngSaved"
| "preview.matchImportLibrary"
| "preview.matchLibraryImported"
| "preview.matchLibraryExists"
| "preview.matchLibraryMissing"
| "preview.matchSettings"
| "preview.matchOutputDirectory"
| "preview.matchResolveLutDirectory"
| "preview.matchCompensation"
| "preview.matchOn"
| "preview.matchOff"
| "preview.matchChooseDirectory"
| "preview.matchUseDefaultDirectory"
| "preview.matchSettingsSaved"
| "preview.matchClearCache"
| "preview.matchCacheCleared"
| "preview.matchHistogram"
| "preview.matchVectorscope"
| "preview.matchScopeNote"
| "preview.matchReferenceDpx"
| "preview.matchDpxNeedsWorkspace"
| "preview.matchSlog3NeedsDpx"

  | "preview.matchOriginal"

  | "preview.matchPalette"

  | "preview.matchPickDirectory"

  | "preview.matchPickReference"

  | "preview.matchProtectContrast"

  | "preview.matchProtectSaturation"

  | "preview.matchProtectSkin"

  | "preview.matchReferenceUnavailable"

  | "preview.matchReset"

  | "preview.matchResult"

  | "preview.matchSaturation"

  | "preview.matchShadows"

  | "preview.matchSize"

  | "preview.matchSourceUnavailable"

  | "preview.matchStrength"

  | "preview.matchTargetMissing"

  | "preview.matchUseCurrentFrame"

  | "preview.matchWaiting"

  | "preview.matchCacheUnavailable"

  | "preview.moveToTrash"

  | "preview.multichannel"

  | "preview.mute"


  | "preview.nextFile"

  | "preview.nextFrame"

  | "preview.noLut"

  | "preview.none"

  | "preview.notes"

  | "preview.notesAddHere"

  | "preview.notesCollapse"

  | "preview.notesDelete"

  | "preview.notesEmpty"

  | "preview.notesPlaceholder"

  | "preview.notesSeekTitle"

  | "preview.notesToggle"


  | "preview.openAsset"

  | "preview.originalUnavailable"

  | "preview.outputDirectory"


  | "preview.paletteCollapse"

  | "preview.paletteError"

  | "preview.paletteExpand"

  | "preview.paletteLoading"

  | "preview.paletteToggleTitle"

  | "preview.panelError"

  | "preview.panelLabel"

  | "preview.panelLoading"

  | "preview.panoramaMode"


  | "preview.pause"

  | "preview.play"

  | "preview.previewNamed"


  | "preview.previousFile"

  | "preview.previousFrame"


  | "preview.rateFps"

  | "preview.rateFpsMenu"

  | "preview.rateSpeed"

  | "preview.reflectionBall"


  | "preview.reveal"

  | "preview.revealInExplorer"


  | "preview.sampleColor"

  | "preview.sampledColors"

  | "preview.sequenceLabel"

  | "preview.sequenceMeta"

  | "preview.setTags"






  | "preview.timeline"

  | "preview.toolbarLabel"

  | "preview.trayLabel"

  | "preview.trim"


  | "preview.viewColor"

  | "preview.volume"

  | "preview.waiting"

  | "sequence.cardLabel"

  | "sequence.chooseConvertPreset"

  | "sequence.closeGifExport"

  | "sequence.closeMp4Export"

  | "sequence.closeNamed"

  | "sequence.confirmExportGif"

  | "sequence.confirmExportMp4"

  | "sequence.dragRangeHint"

  | "sequence.exportedGif"

  | "sequence.exportedMp4"

  | "sequence.exportFailed"

  | "sequence.exportGif"


  | "sequence.exporting"

  | "sequence.exportingGif"

  | "sequence.exportingMp4"

  | "sequence.exportMp4"



  | "sequence.exportSelectedFrames"

  | "sequence.exportWithPreset"

  | "sequence.fps"

  | "sequence.fpsPresetMenu"

  | "sequence.frameAlt"

  | "sequence.frameLoadFailed"

  | "sequence.framesMeta"

  | "sequence.framesShort"

  | "sequence.gifEndFrame"

  | "sequence.gifExportSettings"

  | "sequence.gifFramesSummary"

  | "sequence.gifStartFrame"

  | "sequence.missingFrames"

  | "sequence.missingMore"

  | "sequence.missingSuffix"

  | "sequence.mp4ExportSettings"

  | "sequence.mp4PresetGroup"

  | "sequence.nextFrame"

  | "sequence.pause"

  | "sequence.pickGifDir"

  | "sequence.pickMp4Dir"

  | "sequence.play"

  | "sequence.playbackMeta"

  | "sequence.previewNamed"

  | "sequence.previousFrame"

  | "sequence.resolutionOriginal"

  | "sequence.retryPreview"

  | "sequence.revealGif"


  | "sequence.selectGifRangeTitle"


  | "settings.about"

  | "settings.about.copyVersion"

  | "settings.about.databaseSchema"

  | "settings.about.dataDirectory"

  | "settings.about.indexDatabase"

  | "settings.about.installChannel"

  | "settings.about.libraryNotOpen"

  | "settings.about.openDataFolder"

  | "settings.about.platform"


  | "settings.automaticBackup"

  | "settings.backgroundResidency"

  | "settings.backgroundResidencyHint"

  | "settings.backupNow"

  | "settings.backupNowHint"

  | "settings.board"

  | "settings.board.bringToFront"

  | "settings.board.bringToFrontHint"

  | "settings.board.controls"

  | "settings.board.controlsHint"

  | "settings.board.controlsPureRef"

  | "settings.board.controlsStandard"

  | "settings.board.snap"

  | "settings.board.snapHint"

  | "settings.board.undoLimit"

  | "settings.board.undoLimitHint"

  | "settings.board.undoSteps"

  | "settings.close"

  | "settings.exportDiagnostics"

  | "settings.exportDiagnosticsHint"

  | "settings.exportLibrary"

  | "settings.exportLibraryHint"

  | "settings.importLibrary"

  | "settings.importLibraryHint"

  | "settings.importBundleTitle"

  | "settings.importBundleConfirm"

  | "settings.bundleExported"

  | "settings.general"

  | "settings.globalShortcuts"

  | "settings.globalShortcutsHint"

  | "settings.groups"

  | "settings.language"

  | "settings.languageHint"

  | "settings.layout"

  | "settings.libraryBundleFilter"

  | "settings.localBackups"

  | "settings.maintenance"



  | "settings.manualBackup"

  | "settings.mediaRebuildCancelled"

  | "settings.mediaRebuildCompleted"

  | "settings.mediaRebuildSummary"







  | "settings.options"

  | "settings.capture"

  | "settings.capture.codeHint"

  | "settings.capture.copyCode"

  | "settings.capture.description"

  | "settings.capture.expiresIn"

  | "settings.capture.generate"

  | "settings.capture.lastUsed"

  | "settings.capture.notUsed"

  | "settings.capture.pairedEmpty"

  | "settings.capture.pairedTitle"

  | "settings.capture.regenerate"

  | "settings.capture.revoke"

  | "settings.capture.revokeDescription"

  | "settings.capture.revokePairing"

  | "settings.capture.revokeTitle"

  | "settings.organize"

  | "settings.organize.applyEnabled"

  | "settings.organize.autoTag"

  | "settings.organize.delete"

  | "settings.organize.deleteDescription"

  | "settings.organize.deleteRule"

  | "settings.organize.deleteTitle"

  | "settings.organize.description"

  | "settings.organize.editRule"

  | "settings.organize.editRuleTitle"

  | "settings.organize.empty"

  | "settings.organize.extension"

  | "settings.organize.filenamePattern"

  | "settings.organize.history"

  | "settings.organize.historyUpdated"

  | "settings.organize.matchCount"

  | "settings.organize.newRule"

  | "settings.organize.pathPattern"

  | "settings.organize.previewMatches"

  | "settings.organize.ruleName"

  | "settings.organize.saveRule"

  | "settings.organize.tags"

  | "settings.organize.tagsPlaceholder"

  | "settings.parsingMedia"

  | "settings.parsingMediaOffline"

  | "settings.preview.add"

  | "settings.preview.addExtensionFor"

  | "settings.preview.addWhitelistExtension"

  | "settings.preview.advancedPreview"

  | "settings.preview.alphaBackground"

  | "settings.preview.alphaBackgroundHint"

  | "settings.preview.alphaBlack"

  | "settings.preview.alphaChecker"

  | "settings.preview.alphaCustom"

  | "settings.preview.alphaWhite"

  | "settings.preview.autoplayModel3d"

  | "settings.preview.autoplayModel3dHint"

  | "settings.preview.autoplaySequence"

  | "settings.preview.autoplaySequenceHint"

  | "settings.preview.autoplayVideo"

  | "settings.preview.autoplayVideoHint"

  | "settings.preview.colorManagement"

  | "settings.preview.currentLut"

  | "settings.preview.customAlphaColor"

  | "settings.preview.debugLogging"

  | "settings.preview.debugLoggingHint"

  | "settings.preview.deletePreset"

  | "settings.preview.downscaleBackupMode"

  | "settings.preview.downscaleMode"

  | "settings.preview.downscaleModeHint"

  | "settings.preview.downscaleSubdirectory"

  | "settings.preview.downscaleSubdirMode"

  | "settings.preview.downscaleSuffix"

  | "settings.preview.downscaleSuffixMode"

  | "settings.preview.extensionPlaceholder"

  | "settings.preview.folderOpenDouble"

  | "settings.preview.folderOpenMode"

  | "settings.preview.folderOpenModeHint"

  | "settings.preview.folderOpenSingle"

  | "settings.preview.formatSupport"

  | "settings.preview.local"

  | "settings.preview.locate"

  | "settings.preview.pickLut"

  | "settings.preview.pickOcioConfig"

  | "settings.preview.lutCacheInvalidate"

  | "settings.preview.lutMissing"

  | "settings.preview.lutPlaceholder"

  | "settings.preview.mp4PresetDefault"

  | "settings.preview.mp4Presets"

  | "settings.preview.mp4PresetsHint"

  | "settings.preview.noScripts"

  | "settings.preview.ocioConfigPath"

  | "settings.preview.ocioConfigPathHint"

  | "settings.preview.ocioDetected"

  | "settings.preview.ocioNotDetected"

  | "settings.preview.otherWhitelist"

  | "settings.preview.outputWorkflow"

  | "settings.preview.performance"

  | "settings.preview.presetCodec"

  | "settings.preview.presetEnabled"

  | "settings.preview.presetName"

  | "settings.preview.presetQuality"

  | "settings.preview.presetResolution"

  | "settings.preview.previewConcurrency"

  | "settings.preview.previewConcurrencyHint"

  | "settings.preview.qualityBest"

  | "settings.preview.qualityHigh"

  | "settings.preview.qualityMedium"

  | "settings.preview.register"

  | "settings.preview.registerFailed"

  | "settings.preview.registerScript"

  | "settings.preview.registerScriptDescription"

  | "settings.preview.registerScriptEllipsis"

  | "settings.preview.scriptConfirmDescription"

  | "settings.preview.remove"

  | "settings.preview.removeExtension"

  | "settings.preview.removeWhitelistExtension"

  | "settings.preview.resolutionHalf"

  | "settings.preview.resolutionOriginal"

  | "settings.preview.resolutionQuarter"

  | "settings.preview.scriptMeta"

  | "settings.preview.scriptPathLabel"

  | "settings.preview.scripts"

  | "settings.preview.scriptsHint"

  | "settings.preview.scriptTimeoutLabel"

  | "settings.preview.sequenceFpsPresets"

  | "settings.preview.sequenceFpsPresetsHint"


  | "settings.preview.setDefaultPreset"

  | "settings.preview.showHiddenFiles"

  | "settings.preview.showHiddenFilesHint"

  | "settings.preview.thumbnailWorkerThreads"

  | "settings.preview.thumbnailWorkerThreadsHint"

  | "settings.preview.uiScale"

  | "settings.preview.uiScaleHint"

  | "settings.preview.whitelistHint"

  | "settings.rebuildMediaMetadata"

  | "settings.rebuildMediaMetadataHint"

  | "settings.rebuildThumbnails"

  | "settings.rebuildThumbnailsHint"

  | "settings.restore"

  | "settings.restoreBackupDescription"

  | "settings.restoreBackupTitle"


  | "settings.restoreLayout"




  | "settings.subtitle"

  | "settings.title"

  | "settings.uninstall"

  | "settings.uninstallConfirmButton"

  | "settings.uninstallConfirmDescription"

  | "settings.uninstallConfirmTitle"

  | "settings.uninstallFailed"

  | "settings.uninstallHint"


  | "sidebar.adjustHeight"

  | "sidebar.boards"


  | "sidebar.collapse"

  | "sidebar.directory"


  | "sidebar.expand"

  | "sidebar.hideHiddenFiles"

  | "sidebar.openRecycleBin"

  | "sidebar.quickAccess"

  | "sidebar.recycleBin"

  | "sidebar.showHiddenFiles"

  | "similar.analyzing"

  | "similar.cancelIndex"

  | "similar.comparing"
  | "similar.error"

  | "similar.findFor"

  | "similar.indexing"

  | "similar.indexingHint"

  | "similar.lowerThresholdHint"

  | "similar.noResults"

  | "similar.refresh"

  | "similar.results"

  | "similar.similarity"

  | "similar.title"

  | "status.boardReady"

  | "status.diskReady"

  | "status.hint.boardPureRef"

  | "status.hint.boardStandard"

  | "status.hint.directory"

  | "status.importing"


  | "tasks.cancelTask"

  | "tasks.empty"

  | "tasks.kind.archive"

  | "tasks.kind.batch"

  | "tasks.kind.convert"

  | "tasks.kind.export"

  | "tasks.kind.import"

  | "tasks.retry"


  | "tasks.state.cancelled"

  | "tasks.state.completed"

  | "tasks.state.failed"

  | "tasks.state.queued"

  | "tasks.state.running"

  | "tasks.subtitle"

  | "tasks.title"

  | "text.meta"

  | "text.readFailed"

  | "text.truncated"

  | "archive.meta"

  | "archive.truncated"

  | "archive.unsupported"

  | "archive.upOneLevel"

  | "archive.backToEntries"

  | "archive.emptyDirectory"

  | "archive.entryLoading"

  | "archive.entryUnreadable"

  | "archive.entryUnsupported"


  | "titlebar.exportPng"

  | "titlebar.exportPackage"

  | "titlebar.exportedPackage"

  | "titlebar.exportedPackageSkipped"


  | "titlebar.exportFailedDetail"

  | "titlebar.importProject"

  | "titlebar.importedProject"

  | "titlebar.importFailed"

  | "titlebar.focusBoard"

  | "titlebar.openBoardWindow"


  | "titlebar.pin"

  | "titlebar.presentBoard"


  | "titlebar.screenshot"

  | "titlebar.settings"

  | "titlebar.tasks"

  | "titlebar.unpin"

  | "titlebar.workspace"

  | "video.closeFramesExport"



  | "video.format"


  | "video.fpsPresetTitle"

  | "video.frameAlt"

  | "video.frameError"

  | "video.framesExport"

  | "video.framesExportDialog"

  | "video.framesExported"

  | "video.framesExportFailed"

  | "video.framesExportHint"

  | "video.framesExportShort"

  | "video.gifExport"

  | "video.inPoint"

  | "video.jpgQuality"

  | "video.jpgSmaller"

  | "video.keepSourceFps"

  | "video.mute"

  | "video.openDirectory"

  | "video.outPoint"

  | "video.pickFramesOutputDir"

  | "video.pngLossless"

  | "video.startExport"





  | "video.timeline"

  | "workspace.adjustPanelWidth"

  | "workspace.board"

  | "workspace.boardDefault"

  | "workspace.disk"

  | "workspace.panelAsset"

  | "workspace.panelDetails"

  | "workspace.panelSidebar";
