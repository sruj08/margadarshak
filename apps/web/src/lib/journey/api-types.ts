import type { Schemas } from "@margdarshak/api-client";

/** Contract types from api/openapi.yaml (generated); the UI never hand-writes API shapes. */
export type Case = Schemas["Case"];
export type CasePatch = Schemas["CasePatch"];
export type CaseCreate = Schemas["CaseCreate"];
export type CaseEventCreate = Schemas["CaseEventCreate"];
export type CaseEventType = Schemas["CaseEventType"];
export type CaseEventResult = Schemas["CaseEventResult"];
export type JourneyState = Schemas["JourneyState"];
export type DisplayStage = Schemas["DisplayStage"];
export type PrimaryActionId = Schemas["PrimaryActionId"];
export type StageCode = Schemas["StageCode"];
export type TimelineEvent = Schemas["TimelineEvent"];
export type TimelinePage = Schemas["TimelinePage"];
export type HandoffPack = Schemas["HandoffPack"];
export type ConsentArtefact = Schemas["ConsentArtefact"];
export type ConsentPurpose = Schemas["ConsentPurpose"];
export type FamilyMember = Schemas["FamilyMember"];
export type LabTrialCreate = Schemas["LabTrialCreate"];
export type VehicleClassCode = Schemas["VehicleClassCode"];
export type LearnerLicenceMirror = Schemas["LearnerLicenceMirror"];
export type DrivingLicenceMirror = Schemas["DrivingLicenceMirror"];
export type CasePath = NonNullable<Case["path"]>;

/** Engine path IDs (packages/rules) to the contract's case path enum. */
export function toCasePath(enginePath: string): CasePath {
  return enginePath === "non_aadhaar" ? "non_aadhaar_rto" : "aadhaar_contactless";
}

export function toEnginePath(p: Case["path"]): "aadhaar_contactless" | "non_aadhaar" {
  return p === "non_aadhaar_rto" ? "non_aadhaar" : "aadhaar_contactless";
}
