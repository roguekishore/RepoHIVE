

interface CommunityMember {
  path: string;
  pagerank: number;
  is_entry_point: boolean;
}

interface NeighboringCommunity {
  community_id: number;
  label: string;
  cross_edge_count: number;
}

export interface CommunityDetailResponse {
  community_id: number;
  label: string;
  cohesion: number;
  member_count: number;
  members: CommunityMember[];
  truncated: boolean;
  neighboring_communities: NeighboringCommunity[];
}

export interface CommunitySummaryItem {
  community_id: number;
  label: string;
  cohesion: number;
  member_count: number;
  top_file: string;
}

interface ExecutionFlowEntry {
  entry_point: string;
  entry_point_name: string;
  entry_point_score: number;
  trace: string[];
  depth: number;
  crosses_community: boolean;
  communities_visited: number[];
}

export interface ExecutionFlowsResponse {
  total_entry_points: number;
  flows: ExecutionFlowEntry[];
}
