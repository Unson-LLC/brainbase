/**
 * Jibble API Client
 * Handles all API requests to Jibble
 */

import { getAccessToken } from './auth.js';

const WORKSPACE_API_BASE = 'https://workspace.prod.jibble.io/v1';
const TIME_TRACKING_API_BASE = 'https://time-tracking.prod.jibble.io/v1';
const TIME_ATTENDANCE_API_BASE = 'https://time-attendance.prod.jibble.io/v1';

interface ODataResponse<T> {
  '@odata.context': string;
  value: T[];
}

export interface Person {
  id: string;
  fullName: string;
  preferredName: string;
  email: string;
  role: string;
  status: 'Joined' | 'Removed' | 'Invited';
  code: string;
  'IPersonSetting/BillableRate': number | null;
  latestTimeEntryTime: string | null;
  workStartDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface DailySummary {
  id: string;
  personId: string;
  date: string;
  totalDuration: string;
  regularDuration: string;
  overtimeDuration: string;
  breakDuration: string;
}

export interface HourEntry {
  id: string;
  personId: string;
  organizationId: string;
  projectId: string | null;
  activityId: string | null;
  date: string;
  duration: string;
  note: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrackedTimeEntry {
  id: string;
  trackedTime: string;
  time: string;
  billableAmount: number | null;
  subject: {
    entityType: string;
    name: string;
    chipColor: string | null;
    isDeleted: boolean;
  } | null;
}

export interface TimeEntry {
  id: string;
  personId: string;
  type: 'In' | 'Out' | 'BreakIn' | 'BreakOut';
  dateTime: string;
  projectId: string | null;
  activityId: string | null;
  note: string | null;
}

async function apiRequest<T>(endpoint: string, options: RequestInit & { apiBase?: string } = {}): Promise<T> {
  const token = await getAccessToken();
  const { apiBase = WORKSPACE_API_BASE, ...fetchOptions } = options;

  const response = await fetch(`${apiBase}${endpoint}`, {
    ...fetchOptions,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...fetchOptions.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API request failed: ${response.status} ${error}`);
  }

  return response.json();
}

/**
 * Get all members (People) in the organization
 */
export async function getMembers(options: {
  activeOnly?: boolean;
} = {}): Promise<Person[]> {
  let endpoint = '/People';

  if (options.activeOnly) {
    endpoint += "?$filter=status eq 'Joined'";
  }

  const response = await apiRequest<ODataResponse<Person>>(endpoint);
  return response.value;
}

/**
 * Get a specific member by ID
 */
export async function getMember(personId: string): Promise<Person> {
  const endpoint = `/People('${personId}')`;
  return apiRequest<Person>(endpoint);
}

/**
 * Get daily summaries for a date range
 * Uses Time Attendance API - PayrollHours EntitySet has direct date property
 */
export async function getDailySummaries(options: {
  startDate: string;
  endDate: string;
  personId?: string;
}): Promise<DailySummary[]> {
  // Use PayrollHours (has date property for direct filtering)
  let endpoint = `/PayrollHours?$filter=(date ge ${options.startDate} and date le ${options.endDate})`;

  if (options.personId) {
    endpoint += ` and personId eq ${options.personId}`;
  }

  const response = await apiRequest<ODataResponse<DailySummary>>(endpoint, {
    apiBase: TIME_ATTENDANCE_API_BASE,
  });
  return response.value;
}

/**
 * Get hour entries for a date range
 * Uses Time Tracking API - HourEntry includes projectId and activityId
 */
export async function getHourEntries(options: {
  startDate: string;
  endDate: string;
  personId?: string;
}): Promise<HourEntry[]> {
  let endpoint = `/HourEntries?$filter=(date ge ${options.startDate} and date le ${options.endDate})`;

  if (options.personId) {
    endpoint += ` and personId eq ${options.personId}`;
  }

  const response = await apiRequest<ODataResponse<HourEntry>>(endpoint, {
    apiBase: TIME_TRACKING_API_BASE,
  });
  return response.value;
}

/**
 * Get time entries for a date range
 * Uses Time Tracking API with belongsToDate filter
 */
export async function getTimeEntries(options: {
  startDate: string;
  endDate: string;
  personId?: string;
}): Promise<TimeEntry[]> {
  // Use belongsToDate field for filtering (not dateTime)
  let endpoint = `/TimeEntries?$filter=(belongsToDate ge ${options.startDate} and belongsToDate le ${options.endDate})`;

  if (options.personId) {
    endpoint += ` and personId eq ${options.personId}`;
  }

  // Use $top=120 to avoid Jibble API issue with page size < 119
  endpoint += '&$top=120';

  const response = await apiRequest<ODataResponse<TimeEntry>>(endpoint, {
    apiBase: TIME_TRACKING_API_BASE,
  });
  return response.value;
}

/**
 * Get projects in the organization
 */
export async function getProjects(): Promise<{ id: string; name: string; code: string; status: string }[]> {
  const endpoint = '/Projects?$select=id,name,code,status';
  const response = await apiRequest<ODataResponse<{ id: string; name: string; code: string; status: string }>>(endpoint);
  return response.value;
}

/**
 * Get tracked time report with project breakdown
 * Uses Time Attendance API - includes project/activity information via subject
 */
export async function getTrackedTimeReport(options: {
  personId?: string;
}): Promise<TrackedTimeEntry[]> {
  // TrackedTimeReport with subject expansion to get project info
  // Note: This endpoint does NOT support date filtering - use HourEntries for date-filtered project data
  let endpoint = '/TrackedTimeReport?$expand=subject';

  if (options.personId) {
    endpoint += `&$filter=personId eq ${options.personId}`;
  }

  const response = await apiRequest<ODataResponse<TrackedTimeEntry>>(endpoint, {
    apiBase: TIME_ATTENDANCE_API_BASE,
  });
  return response.value;
}
