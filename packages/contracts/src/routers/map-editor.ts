import { z } from 'zod';
import { protectedProcedure, router } from '../trpc.js';
import {
  AddLandmarkInput,
  DecideMapReportInput,
  EditLandmarkInput,
  MAP_EDIT_ROLES,
  MAP_READ_ROLES,
  MAP_REPORT_ROLES,
  MapEditorInput,
  MapEditView,
  MapHistoryInput,
  MapInbox,
  MapLandmark,
  MapLayers,
  MapReportAck,
  MergeLandmarksInput,
  MovePinsInput,
  ReportMapFixInput,
  UndoMapEditInput,
} from '../map-editor-io.js';

/** `ops.mapEditor.*` — Console › محرر الخريطة: restaurants and landmarks on one map, a history to undo, and the fixes inbox. */
export const opsMapEditorRouter = router({
  layers: protectedProcedure(MAP_READ_ROLES).input(MapEditorInput).output(MapLayers)
    .query(({ ctx, input }) => ctx.mapEditor.layers(ctx.actor, input)),
  addLandmark: protectedProcedure(MAP_EDIT_ROLES).input(AddLandmarkInput).output(MapLandmark)
    .mutation(({ ctx, input }) => ctx.mapEditor.addLandmark(ctx.actor, input)),
  editLandmark: protectedProcedure(MAP_EDIT_ROLES).input(EditLandmarkInput).output(MapLandmark)
    .mutation(({ ctx, input }) => ctx.mapEditor.editLandmark(ctx.actor, input)),
  /** A drag of one pin or of several picked together; a restaurant's zone is read from its new pin. */
  movePins: protectedProcedure(MAP_EDIT_ROLES).input(MovePinsInput).output(MapLayers)
    .mutation(({ ctx, input }) => ctx.mapEditor.movePins(ctx.actor, input)),
  /** Two landmarks that are one place: the dropped one is hidden and its name kept as another name. */
  merge: protectedProcedure(MAP_EDIT_ROLES).input(MergeLandmarksInput).output(MapLandmark)
    .mutation(({ ctx, input }) => ctx.mapEditor.merge(ctx.actor, input)),
  history: protectedProcedure(MAP_READ_ROLES).input(MapHistoryInput).output(z.array(MapEditView))
    .query(({ ctx, input }) => ctx.mapEditor.history(ctx.actor, input)),
  undo: protectedProcedure(MAP_EDIT_ROLES).input(UndoMapEditInput).output(MapEditView)
    .mutation(({ ctx, input }) => ctx.mapEditor.undo(ctx.actor, input)),
  /** From the apps: a place moved, a new place, a wrong name, a place that closed. Lands in the inbox. */
  report: protectedProcedure(MAP_REPORT_ROLES).input(ReportMapFixInput).output(MapReportAck)
    .mutation(({ ctx, input }) => ctx.mapEditor.report(ctx.actor, input)),
  inbox: protectedProcedure(MAP_READ_ROLES).input(MapEditorInput).output(MapInbox)
    .query(({ ctx, input }) => ctx.mapEditor.inbox(ctx.actor, input)),
  decide: protectedProcedure(MAP_EDIT_ROLES).input(DecideMapReportInput).output(MapInbox)
    .mutation(({ ctx, input }) => ctx.mapEditor.decide(ctx.actor, input)),
});
