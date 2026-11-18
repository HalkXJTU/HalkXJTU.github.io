import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const appData = process.env.LOCALAPPDATA || process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
const ownerData = join(appData, 'HalkHomepage');
export const privateReleaseDir = resolve(process.env.SITE_RELEASE_DIR || join(ownerData, 'releases'));
export const localAccessDir = resolve(process.env.SITE_ACCESS_DIR || join(ownerData, 'access-local'));
