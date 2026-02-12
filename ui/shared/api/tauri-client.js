import { invoke } from '@tauri-apps/api/core';

export async function invokeCommand(command, payload) {
    return invoke(command, payload);
}
