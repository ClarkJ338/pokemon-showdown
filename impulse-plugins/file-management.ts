/* Server Files Management Commands
*
* Instructions:
* - Important: Obtain a GitHub "personal access token" with the "gist" permission.
* - Set this token as Config.githubToken in your configuration.
* - (Directly adding the token to the code is strongly discouraged for security).
* - These commands are restricted to users with console access for security.
*
* Credits: HoeenHero ( Original HasteBin Code )
* Updates & Typescript Conversion:
* Prince Sky
*/

import * as https from 'https';
import { FS } from '../lib/fs';

const GITHUB_API_URL = 'https://api.github.com/gists';
const GITHUB_TOKEN = Config.githubToken || "";

interface GistResponse {
  id: string;
  html_url: string;
}

function notifyStaff(action: string, file: string, user: any, additionalInfo?: string) {
  const staffRoom = Rooms.get('staff');
  if (staffRoom) {
    let message = `<strong>[FILE MANAGEMENT]</strong> ${action}<br>`;
    message += `<strong>File:</strong> ${file}<br>`;
    message += `<strong>User:</strong> <username>${user.id}</username>`;
    if (additionalInfo) {
      message += `<br>${additionalInfo}`;
    }
    staffRoom.addRaw(`<div class="broadcast-blue">${message}</div>`).update();
  }
}

async function uploadToGist(toUpload: string, originalFilenameWithPath: string, description = 'Uploaded via bot') {
  if (!GITHUB_TOKEN) {
    throw new Error('GitHub token not found.');
  }

  const parts = originalFilenameWithPath.split('/');
  const baseFilename = parts[parts.length - 1];

  const postData = JSON.stringify({
    description: description,
    public: false,
    files: {
      [baseFilename]: {
        content: toUpload,
      },
    },
  });

  const reqOpts = {
    hostname: 'api.github.com',
    path: '/gists',
    method: 'POST',
    headers: {
      'User-Agent': 'YourBotName',
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'Content-Length': postData.length,
    },
  };

  return new Promise<string>((resolve, reject) => {
    const req = https.request(reqOpts, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode === 201) {
          try {
            const gistResponse: GistResponse = JSON.parse(data);
            resolve(gistResponse.html_url);
          } catch (e) {
            reject(new Error(`Failed to parse GitHub API response: ${e}`));
          }
        } else {
          reject(new Error(`GitHub API error: ${res.statusCode} - ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

export const commands: Chat.ChatCommands = {
  file: 'getfile',
  fileretrieval: 'getfile',
  retrievefile: 'getfile',
  async getfile(this: CommandContext, target, room, user) {
    if (!this.runBroadcast()) return;
    if (!target) return this.parse('/help getfile');
    if (!user.hasConsoleAccess(user.connections[0])) return this.errorReply("You don't have permission to use this command.");
    const file = target.trim();

    if (!GITHUB_TOKEN) {
      return this.errorReply("The GitHub token is not set. Please configure Config.githubToken in your configuration.");
    }

    try {
      const data = await FS(file).read();
      try {
        const gistUrl = await uploadToGist(data, file, `File: ${file} uploaded by ${user.id}`);
        this.sendReplyBox(`<strong>File:</strong> ${file}<br>` +
          //`<strong>Gist URL:</strong> <button onclick="window.open('${gistUrl}', '_blank')" style="padding: 4px 8px; background-color: #007cba; color: white; border: none; border-radius: 4px; cursor: pointer;">View Gist</button><br>` +
			 `<strong>Gist URL:</strong> <a href="${gistUrl}" target="_blank">View File</a><br>` +
          `<strong>Command Used By:</strong> <username>${user.id}</username>`);
        
        // Notify staff
        notifyStaff('File Retrieved and Uploaded to Gist', file, user);
      } catch (error) {
        this.errorReply(`An error occurred while attempting to upload to GitHub Gist: ${error}`);
      }
    } catch (error) {
      this.errorReply(`Failed to load ${file}: ${error}`);
    }
    if (room) room.update();
  },

  getfilehelp: [
    '/getgile <file name>: Uploads a server file to a private GitHub Gist.',
    'Example: /getfile config/config.js',
    'Note: Requires Config.githubToken to be set in configuration.',
  ],

  forcewritefile: 'writefile',
  async writefile(this: CommandContext, target, room, user, connection, cmd) {
    if (!user.hasConsoleAccess(user.connections[0])) return this.errorReply("You don't have permission to use this command.");
    if (!this.runBroadcast()) return;
    const targets = target.split(',').map(x => x.trim());
    if (targets.length !== 2) return this.errorReply(`/writefile [github gist raw link to write from], [file to write too]`);
    if (!targets[0].startsWith('https://gist.githubusercontent.com/')) return this.errorReply(`Link must start with https://gist.githubusercontent.com/`);
    try {
      FS(targets[1]).readSync();
    } catch (e) {
      if (cmd !== 'forcewritefile') return this.errorReply(`The file "${targets[1]}" was not found. Use /forcewritefile to forcibly create & write to the file.`);
    }
    try {
      const response = await new Promise<string>((resolve, reject) => {
        https.get(targets[0], (res) => {
          let data = '';
          res.on('data', (part) => {
            data += part;
          });
          res.on('end', () => {
            if (res.statusCode === 200) {
              resolve(data);
            } else {
              reject(new Error(`Failed to fetch Gist content: ${res.statusCode}`));
            }
          });
          res.on('error', reject);
        }).on('error', reject);
      });
      FS(targets[1]).writeSync(response);
      this.sendReplyBox(`<strong>File:</strong> ${targets[1]}<br>` +
        `<strong>Source:</strong> <button onclick="window.open('${targets[0]}', '_blank')" style="padding: 4px 8px; background-color: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer;">View Source</button><br>` +
        `<strong>Command Used By:</strong> <username>${user.id}</username><br>` +
        `<strong>Status:</strong> Written successfully`);
      
      // Notify staff
      const actionType = cmd === 'forcewritefile' ? 'File Force Written' : 'File Written';
      notifyStaff(actionType, targets[1], user);
    } catch (error) {
      this.errorReply(`An error occurred while fetching or writing the file:\t${error}`);
    }
  },

  async deletefile(this: CommandContext, target, room, user) {
    if (!user.hasConsoleAccess(user.connections[0])) return this.errorReply("You don't have permission to use this command.");
    if (!this.runBroadcast()) return;
    if (!target) return this.parse('/help deletefile');
    const file = target.trim();

    try {
      // Check if file exists first
      await FS(file).read();
      
      // Delete the file
      FS(file).unlinkSync();
      
      this.sendReplyBox(`<strong>File:</strong> ${file}<br>` +
        `<strong>Action:</strong> Deleted successfully<br>` +
        `<strong>Command Used By:</strong> <username>${user.id}</username><br>` +
        `<strong>Status:</strong> <span style="color: #dc3545;">File removed</span>`);
      
      // Notify staff
      notifyStaff('File Deleted', file, user, `<strong>Status:</strong> <span style="color: #dc3545;">Permanently removed</span>`);
    } catch (error) {
      this.errorReply(`Failed to delete ${file}: ${error}`);
    }
    if (room) room.update();
  },

  deletefilehelp: [
    '/deletefile <file name>: Deletes a server file.',
    'Example: /deletefile logs/old.log',
    'Note: This action is irreversible. Use with caution.',
  ],

  async movefile(this: CommandContext, target, room, user) {
    if (!user.hasConsoleAccess(user.connections[0])) return this.errorReply("You don't have permission to use this command.");
    if (!this.runBroadcast()) return;
    if (!target) return this.parse('/help movefile');
    
    const targets = target.split(',').map(x => x.trim());
    if (targets.length !== 2) return this.errorReply('/movefile [source file], [destination file]');
    
    const [sourceFile, destFile] = targets;

    try {
      // Check if source file exists
      const data = await FS(sourceFile).read();
      
      // Write to destination
      FS(destFile).writeSync(data);
      
      // Delete source file
      FS(sourceFile).unlinkSync();
      
      this.sendReplyBox(`<strong>Source File:</strong> ${sourceFile}<br>` +
        `<strong>Destination File:</strong> ${destFile}<br>` +
        `<strong>Action:</strong> Moved successfully<br>` +
        `<strong>Command Used By:</strong> <username>${user.id}</username><br>` +
        `<strong>Status:</strong> <span style="color: #28a745;">File moved</span>`);
      
      // Notify staff
      notifyStaff('File Moved', `${sourceFile} → ${destFile}`, user);
    } catch (error) {
      this.errorReply(`Failed to move ${sourceFile} to ${destFile}: ${error}`);
    }
    if (room) room.update();
  },

  movefilehelp: [
    '/movefile <source file>, <destination file>: Moves a server file to a new location.',
    'Example: /movefile logs/old.log, backup/old.log',
    'Note: This will delete the source file after copying.',
  ],

  async copyfile(this: CommandContext, target, room, user) {
    if (!user.hasConsoleAccess(user.connections[0])) return this.errorReply("You don't have permission to use this command.");
    if (!this.runBroadcast()) return;
    if (!target) return this.parse('/help copyfile');
    
    const targets = target.split(',').map(x => x.trim());
    if (targets.length !== 2) return this.errorReply('/copyfile [source file], [destination file]');
    
    const [sourceFile, destFile] = targets;

    try {
      // Check if source file exists and read it
      const data = await FS(sourceFile).read();
      
      // Write to destination
      FS(destFile).writeSync(data);
      
      this.sendReplyBox(`<strong>Source File:</strong> ${sourceFile}<br>` +
        `<strong>Destination File:</strong> ${destFile}<br>` +
        `<strong>Action:</strong> Copied successfully<br>` +
        `<strong>Command Used By:</strong> <username>${user.id}</username><br>` +
        `<strong>Status:</strong> <span style="color: #17a2b8;">File copied</span>`);
      
      // Notify staff
      notifyStaff('File Copied', `${sourceFile} → ${destFile}`, user);
    } catch (error) {
      this.errorReply(`Failed to copy ${sourceFile} to ${destFile}: ${error}`);
    }
    if (room) room.update();
  },

  copyfilehelp: [
    '/copyfile <source file>, <destination file>: Copies a server file to a new location.',
    'Example: /copyfile config/config.js, backup/config.js',
    'Note: This preserves the original file.',
  ],
};
