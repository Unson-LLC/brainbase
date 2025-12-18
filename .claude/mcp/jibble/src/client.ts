/**
 * Jibble API Client
 * Handles all API requests to Jibble
 */

import { getAccessToken } from './auth.js';

const WORKSPACE_API_BASE = 'https://workspace.prod.jibble.io/v1';

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

export interface TimeEntry {
  id: string;
  personId: string;
  type: 'In' | 'Out' | 'BreakIn' | 'BreakOut';
  dateTime: string;
  projectId: string | null;
  activityId: string | null;
  note: string | null;
}

async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();

  const response = await fetch(`${WORKSPACE_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
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
 */
export async function getDailySummaries(options: {
  startDate: string;
  endDate: string;
  personId?: string;
}): Promise<DailySummary[]> {
  let endpoint = `/DailySummaries?$filter=date ge ${options.startDate} and date le ${options.endDate}`;

  if (options.personId) {
    endpoint += ` and personId eq ${options.personId}`;
  }

  const response = await apiRequest<ODataResponse<DailySummary>>(endpoint);
  return response.value;
}

/**
 * Get time entries for a date range
 */
export async function getTimeEntries(options: {
  startDate: string;
  endDate: string;
  personId?: string;
}): Promise<TimeEntry[]> {
  let endpoint = `/TimeEntries?$filter=dateTime ge ${options.startDate}T00:00:00Z and dateTime le ${options.endDate}T23:59:59Z`;

  if (options.personId) {
    endpoint += ` and personId eq ${options.personId}`;
  }

  const response = await apiRequest<ODataResponse<TimeEntry>>(endpoint);
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
