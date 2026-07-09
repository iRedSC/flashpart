import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "gc promoted photo storage",
  { hours: 6 },
  internal.photoGc.gcPromotedStorage,
  {},
);

crons.interval(
  "gc abandoned photo uploads",
  { hours: 1 },
  internal.photoGc.gcAbandonedUploads,
  {},
);

export default crons;
