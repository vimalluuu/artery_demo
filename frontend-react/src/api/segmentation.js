import api from "./client.js";
import { createSegmentationApi } from "./segmentation-contract.js";

export const segmentationApi = createSegmentationApi(api);
