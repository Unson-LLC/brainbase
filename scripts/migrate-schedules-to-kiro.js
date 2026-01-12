#!/usr/bin/env node
/**
 * Migrate schedules from legacy format to Kiro format
 *
 * Legacy format: _schedules/YYYY-MM.md with ### YYYY-MM-DD sections
 * Kiro format: _schedules/YYYY-MM-DD/schedule.md
 *
 * Usage:
 *   node scripts/migrate-schedules-to-kiro.js [--dry-run] [--backup]
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { KiroScheduleParser } from '../lib/kiro-schedule-parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

class ScheduleMigrator {
    constructor(options = {}) {
        this.dryRun = options.dryRun || false;
        this.backup = options.backup !== false; // default true
        this.schedulesDir = options.schedulesDir || path.join(ROOT, '_schedules');
        this.backupDir = options.backupDir || path.join(ROOT, '_schedules-backup');
        this.parser = new KiroScheduleParser();
        this.stats = {
            filesProcessed: 0,
            datesExtracted: 0,
            eventsCreated: 0,
            errors: []
        };
    }

    /**
     * Parse a legacy schedule file and extract date sections
     * @param {string} content - File content
     * @returns {Map<string, Array>} - Map of date -> events
     */
    parseLegacyFile(content) {
        const lines = content.split('\n');
        const dateEvents = new Map();
        let currentDate = null;

        for (const line of lines) {
            // Date header: ### YYYY-MM-DD or ### YYYY-MM-DD Day
            const dateMatch = line.match(/^###\s+(\d{4}-\d{2}-\d{2})/);
            if (dateMatch) {
                currentDate = dateMatch[1];
                if (!dateEvents.has(currentDate)) {
                    dateEvents.set(currentDate, []);
                }
                continue;
            }

            // Skip if no current date
            if (!currentDate) continue;

            // Event line: - HH:MM-HH:MM Title or - HH:MM Title
            const eventMatch = line.match(/^-\s*(\d{1,2}:\d{2})(?:-(\d{1,2}:\d{2}))?\s+(.+)$/);
            if (eventMatch) {
                const [, start, end, title] = eventMatch;
                dateEvents.get(currentDate).push({
                    start: start.padStart(5, '0'),
                    end: end ? end.padStart(5, '0') : null,
                    title: title.trim()
                });
            }
        }

        return dateEvents;
    }

    /**
     * Convert legacy events to Kiro format
     * @param {Array} events - Legacy events
     * @returns {string} - Kiro format content
     */
    convertToKiro(events) {
        let content = '';
        for (const event of events) {
            const kiroEvent = {
                id: this.parser.generateId(),
                start: event.start,
                end: event.end,
                title: event.title,
                source: 'manual',
                completed: false
            };
            content += this.parser.serializeEvent(kiroEvent);
        }
        return content;
    }

    /**
     * Create backup of _schedules directory
     */
    async createBackup() {
        if (!this.backup) return;

        console.log(`📦 Creating backup at ${this.backupDir}...`);

        if (this.dryRun) {
            console.log('   [DRY RUN] Would create backup');
            return;
        }

        try {
            // Remove old backup if exists
            await fs.rm(this.backupDir, { recursive: true, force: true });

            // Copy _schedules to _schedules-backup
            await this._copyDir(this.schedulesDir, this.backupDir);

            console.log('   ✅ Backup created');
        } catch (error) {
            console.error('   ❌ Backup failed:', error.message);
            throw error;
        }
    }

    /**
     * Recursively copy directory
     */
    async _copyDir(src, dest) {
        await fs.mkdir(dest, { recursive: true });
        const entries = await fs.readdir(src, { withFileTypes: true });

        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);

            if (entry.isDirectory()) {
                await this._copyDir(srcPath, destPath);
            } else {
                await fs.copyFile(srcPath, destPath);
            }
        }
    }

    /**
     * Migrate a single legacy file
     * @param {string} filePath - Path to legacy file
     */
    async migrateFile(filePath) {
        const fileName = path.basename(filePath);
        console.log(`\n📄 Processing ${fileName}...`);

        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const dateEvents = this.parseLegacyFile(content);

            if (dateEvents.size === 0) {
                console.log('   ⚠️  No date sections found');
                return;
            }

            this.stats.filesProcessed++;

            for (const [date, events] of dateEvents) {
                if (events.length === 0) {
                    console.log(`   📅 ${date}: No events`);
                    continue;
                }

                const dateDir = path.join(this.schedulesDir, date);
                const scheduleFile = path.join(dateDir, 'schedule.md');

                console.log(`   📅 ${date}: ${events.length} event(s)`);

                if (this.dryRun) {
                    console.log(`      [DRY RUN] Would create ${scheduleFile}`);
                } else {
                    await fs.mkdir(dateDir, { recursive: true });
                    const kiroContent = this.convertToKiro(events);
                    await fs.writeFile(scheduleFile, kiroContent, 'utf-8');
                }

                this.stats.datesExtracted++;
                this.stats.eventsCreated += events.length;
            }
        } catch (error) {
            console.error(`   ❌ Error: ${error.message}`);
            this.stats.errors.push({ file: filePath, error: error.message });
        }
    }

    /**
     * Run the migration
     */
    async run() {
        console.log('🚀 Schedule Migration to Kiro Format');
        console.log('=====================================');

        if (this.dryRun) {
            console.log('🔍 DRY RUN MODE - No files will be modified\n');
        }

        // Create backup
        await this.createBackup();

        // Find legacy files (YYYY-MM.md pattern)
        const entries = await fs.readdir(this.schedulesDir, { withFileTypes: true });
        const legacyFiles = entries
            .filter(e => e.isFile() && /^\d{4}-\d{2}\.md$/.test(e.name))
            .map(e => path.join(this.schedulesDir, e.name));

        if (legacyFiles.length === 0) {
            console.log('\n⚠️  No legacy schedule files found (YYYY-MM.md)');
            return;
        }

        console.log(`\n📁 Found ${legacyFiles.length} legacy file(s)`);

        // Migrate each file
        for (const filePath of legacyFiles) {
            await this.migrateFile(filePath);
        }

        // Print summary
        this.printSummary();
    }

    /**
     * Print migration summary
     */
    printSummary() {
        console.log('\n=====================================');
        console.log('📊 Migration Summary');
        console.log('=====================================');
        console.log(`   Files processed: ${this.stats.filesProcessed}`);
        console.log(`   Dates extracted: ${this.stats.datesExtracted}`);
        console.log(`   Events created:  ${this.stats.eventsCreated}`);

        if (this.stats.errors.length > 0) {
            console.log(`   ❌ Errors: ${this.stats.errors.length}`);
            for (const err of this.stats.errors) {
                console.log(`      - ${err.file}: ${err.error}`);
            }
        }

        if (this.dryRun) {
            console.log('\n🔍 This was a dry run. No files were modified.');
            console.log('   Run without --dry-run to perform actual migration.');
        } else {
            console.log('\n✅ Migration complete!');
            console.log('   Set KIRO_SCHEDULE_FORMAT=true in .env to use new format.');
        }
    }
}

// Main
async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const noBackup = args.includes('--no-backup');

    const migrator = new ScheduleMigrator({
        dryRun,
        backup: !noBackup
    });

    try {
        await migrator.run();
    } catch (error) {
        console.error('\n❌ Migration failed:', error.message);
        process.exit(1);
    }
}

main();
