/**
 * state.js - Global application state management
 *
 * Centralized state for brainbase-ui.
 * Other modules import and use getter/setter functions.
 */

// --- Application State ---
let sessions = [];
let currentSessionId = null;
let tasks = [];
let schedule = null;
let showAllTasks = false;
let showArchived = false;

// Drag & Drop State
let draggedSessionId = null;
let draggedSessionProject = null;

// --- Constants ---
export const MAX_VISIBLE_TASKS = 3;
export const CORE_PROJECTS = ['brainbase', 'unson', 'tech-knight', 'salestailor', 'zeims', 'baao', 'ncom', 'senrigan'];

// --- Getters ---
export function getSessions() {
    return sessions;
}

export function getCurrentSessionId() {
    return currentSessionId;
}

export function getTasks() {
    return tasks;
}

export function getSchedule() {
    return schedule;
}

export function getShowAllTasks() {
    return showAllTasks;
}

export function getShowArchived() {
    return showArchived;
}

export function getDraggedSessionId() {
    return draggedSessionId;
}

export function getDraggedSessionProject() {
    return draggedSessionProject;
}

// --- Setters ---
export function setSessions(newSessions) {
    sessions = newSessions;
}

export function setCurrentSessionId(id) {
    currentSessionId = id;
}

export function setTasks(newTasks) {
    tasks = newTasks;
}

export function setSchedule(newSchedule) {
    schedule = newSchedule;
}

export function setShowAllTasks(value) {
    showAllTasks = value;
}

export function setShowArchived(value) {
    showArchived = value;
}

export function setDraggedSessionId(id) {
    draggedSessionId = id;
}

export function setDraggedSessionProject(project) {
    draggedSessionProject = project;
}

// --- Utility Functions ---
export function toggleShowAllTasks() {
    showAllTasks = !showAllTasks;
    return showAllTasks;
}

export function toggleShowArchived() {
    showArchived = !showArchived;
    return showArchived;
}

export function findSessionById(id) {
    return sessions.find(s => s.id === id);
}

export function findTaskById(id) {
    return tasks.find(t => t.id === id);
}
