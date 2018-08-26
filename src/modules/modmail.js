const Parse = require("../util/parse.js");
const Embed = require("../util/embed.js");
const DataManager = require("../util/datamanager.js");
const Router = require("../util/router.js");

class ModMail extends Parse {
  constructor(message) {
    super(message);
    this.modmail = this.reactionmessages.modmail || {};
  }

  setData (modmail) {
    this.reactionmessages.modmail = modmail;
    DataManager.setServer(this.reactionmessages, "./src/data/reactionmessages.json");
  }

  async receiver (guild) { //receive a guild as an input, set it to this.guild
    this.guild = guild;
    if (this.modmail) { //if the server has had modmail in the past
      if (this.modmail._timeout && this.modmail._timeout[this.author.tag]) { //check if they're timed out
        if (Date.now() - this.modmail._timeout[this.author.tag] < 86400000) return; //if so, return completely
        delete this.modmail._timeout[this.author.tag]; //otherwise delete any old timeout
      };
      for (let id in this.modmail) { //for each record
        if (id.startsWith("_")) continue; //ignore _timeout and _id
        if (this.modmail[id].tag === this.author.tag && !this.modmail[id].overflow) { //if the user hasn't mailed in the past or the post is more than 2000 characters, make a new one
          let channel = this.Search.channels.get(this.server.channels.modmail);
          try {
            let modmail = await channel.fetchMessage(id) //so if they have a chat history, find it
            let embed = modmail.embeds[0];
            if (Date.now() - this.modmail[modmail.id].lastMail < 1800000 && embed.fields[embed.fields.length - 1].name.includes("user wrote:")) {
              embed.fields[embed.fields.length - 1].value += "\n" + this.message.content;
              this.editor(embed, modmail); //and if they had last message, less than half an hour ago, merely append it with new line
              this.modmail[modmail.id].lastMail = Date.now();
            } else {
              this.sender(embed.fields); //otherwise we're making a new post, extending the fields of the old post
              modmail.delete(); //so delete the message
              delete this.modmail[modmail.id]; //and delete the record
            };
            this.setData(this.modmail);
          } catch (e) {
            await this.Output.confirm({channel,
              "description": "Couldn't find message. Please confirm that message no longer exists.",
              "author": mod
            });
            delete this.modmail[id]; //and delete the record
            this.sender([]); //and make a new post
            this.setData(this.modmail);
            return;
          }
        }
      }
    } else this.modmail = {
      "_timeout": {}
    }; //if there's no modmail stored for this channel 
    this.sender([]); //if it's a new message it gets sent straight
  }

 async sender (fields, mailInfo) { //make a new post. All posts look the same, but you can have more 'previous' fields to add a history
    try {
      let tag = mailInfo ? mailInfo.tag : this.author.tag;
      let timestamp = Date.getISOtime(this.message.createdAt);
      let modmail = await this.Output.reactor({
        "title": "ModMail Conversation for " + tag,
        "fields": Embed.fielder(fields || [], "On " + timestamp + ", " + (this.mod ? this.mod.tag : "user") + (this.mod && !this.mod.flair ? " 🗣" : "") +" wrote:", this.message.content, false),
      }, this.Search.channels.get(this.server.channels.modmail), ["❎", "🗣", "👤", "👁", "❗", "⏲"]);
      this.modmail[modmail.id] = { //and create a new record with the new message created entry
        "tag": tag,
        "lastMail": Date.now()
      };
      this.setData(this.modmail);
      return modmail;
    } catch (e) {
      if (e) this.Output.onError(e);
    }
  }

  async editor (embed, message, mailInfo) {
    try {
      if (JSON.stringify(Embed.receiver(embed)).length < 2000) return await this.Output.editor(embed, message); //check if the message would be more than 2000 characters
      message.clearReactions();
      let msg = await this.sender([], mailInfo) //if so, create a new post
      this.modmail[message.id].overflow = msg.id;
      this.setData(this.modmail);
    } catch (e) {
      if (e) this.Output.onError(e);
    }
  }

  async react (reaction, user) {
    switch (reaction.emoji.name) {
      case "❎":
        this.close(reaction.message, user, this.modmail[reaction.message.id]);
        reaction.remove(user);
        break;
      case "🗣":
        this.reply(reaction.message, Object.assign(user, {"flair": false}), this.modmail[reaction.message.id]);
        reaction.remove(user);
        break;
      case "👤":
        this.reply(reaction.message, Object.assign(user, {"flair": true}), this.modmail[reaction.message.id]);
        reaction.remove(user);
        break;
      case "👁": //"seen" 
        break;
      case "❗":
        this.warn(reaction.message, user, this.modmail[reaction.message.id]);
        reaction.remove(user);
        break;
      case "⏲":
        this.timeout(reaction.message, user, this.modmail[reaction.message.id]);
        reaction.remove(user);
        break;
      default:
        reaction.remove(user);
        break;
    }
  }

  async reply (message, mod, mailInfo) {
    try {
      let user = this.Search.users.byTag(mailInfo.tag);
      if (!user) throw "User **" + user.tag + "** no longer exists!";
      let msg = await this.Output.response({
        "author": mod,
        "description": "Please type your response below (replying as " + (mod.flair ? "yourself" : "server") + ")"
      }, true);
      if (msg.attachments) for(let [id, attachment] of msg.attachments)
        msg.content += " [Image Attachment](" + attachment.url + ")"; //if there's any images, append them as a link to the DM image
      if (msg.content.length > 1024) throw "Your message must be less than 1024 characters!\nPlease shorten it by **" + (msg.content.length - 1024) + "** characters.";
      this.message = msg, this.mod = mod;
      let timestamp = Date.getISOtime(Date.now()), embed = message.embeds[0];
      embed.fields = Embed.fielder(embed.fields, "On " + timestamp + ", " + mod.tag + (!mod.flair ? " 🗣" : "") + " wrote:", msg.content, false)
      this.editor(embed, message, mailInfo);
      this.Output.sender({
        "title": "New mail from " + (mod.flair ? mod.tag + " via " : "server ") + this.guild.name + ":",
        "description": msg.content
      }, user);
      msg.delete();
      Router.logCommand({
        "author": mod,
        "args": [!mod.flair ? "server" : "self", user.tag, msg.content],
        "command": "reply"
      }, {
        "file": "Mod Mail",
        "prefix": ""
      });
    } catch (e) {
      if (e) this.Output.onError(e);
    }
  }

  async close (message, mod, mailInfo) {
    try {
      await this.Output.confirm({
        "action": "closing the conversation for user **" + mailInfo.tag + "**",
        "author": mod
      });
      for (let id in this.modmail) {
        if (this.modmail[id].tag === mailInfo.tag) {
          let msg = await message.channel.fetchMessage(id)
          msg.delete();
          delete this.modmail[id];
        }
      };
      this.setData(this.modmail);
      this.Output.generic("**" + mod.tag + "** closed the ModMail conversation for **" + mailInfo.tag + "**.");
      Router.logCommand({
        "author": mod,
        "args": mailInfo.tag,
        "command": "close"
      }, {
        "file": "Mod Mail",
        "prefix": ""
      });
    } catch (e) {
      if (e) this.Output.onError(e);
    }
  }

  async warn (message, mod, mailInfo) {
    try {
      await this.Output.confirm({
        "action": "warning for user **" + mailInfo.tag + "**",
        "author": mod
      });
      let timestamp = Date.getISOtime(Date.now());
      let embed = message.embeds[0];
      embed.fields = Embed.fielder(embed.fields, "On " + timestamp + ", " + mod.tag + " warned user.", "", false)
      this.editor(embed, message);
      this.Output.sender({
        "title": "Warning from server " + this.guild.name + ":",
        "description": "You are abusing server modmail. Please be polite and do not spam the inbox."
      }, this.Search.users.byTag(mailInfo.tag));
      Router.logCommand({
        "author": mod,
        "args": mailInfo.tag,
        "command": "warn"
      }, {
        "file": "Mod Mail",
        "prefix": ""
      });
    } catch (e) {
      if (e) this.Output.onError(e);
    }
  }

  async timeout (message, mod, mailInfo) {
    try {
      await this.Output.confirm({
        "action": "timeout for user **" + mailInfo.tag + "**",
        "author": mod
      });
      let timestamp = Date.getISOtime(Date.now());
      let embed = message.embeds[0];
      embed.fields = Embed.fielder(embed.fields, "On " + timestamp + ", " + mod.tag + " timed out user for 24h.", "", false)
      if (!this.modmail._timeout) this.modmail._timeout = {};
      this.modmail._timeout[mailInfo.tag] = Date.now();
      this.setData(this.modmail);
      this.editor(embed, message);
      this.Output.sender({
        "title": "You have been timed out from sending messages to server " + this.guild.name + ":",
        "description": "The mod team will not receive your messages for 24 hours."
      }, this.Search.users.byTag(mailInfo.tag));
      Router.logCommand({
        "author": mod,
        "args": mailInfo.tag,
        "command": "timeout"
      }, {
        "file": "Mod Mail",
        "prefix": ""
      });
    } catch (e) {
      if (e) this.Output.onError(e);
    }
  }

  //Old code from here onwards

  typeadd (args, argument) {
    let argsindex = -1;
    if(argument.match(/[^a-zA-Z0-9\.!\?',;:"£\$%~\+=()\s\u200B-\u200D\uFEFF-]+/g)) return this.Output.onError(`Invalid characters; please reformat your quote.`);
    for(let i = args.length -1; i >= 0; i--) {
      if(args[i].startsWith("-")) argsindex = i;
    };
    if(argsindex === -1) return this.Output.onError(`No source provided/Incorrect format!`);
    let text = args.slice(0, argsindex).join(" ");
    let source = args.slice(argsindex, args.length).join(" ").slice(1).trim();
    if(text.startsWith(`"`) && text.endsWith(`"`)) text = text.slice(1, -1);
    if(text.length < 265) return this.Output.onError(`Entry **${265 - text.length}** characters too short! Please try again.`);
    if(text.length > 529) return this.Output.onError(`Entry **${text.length - 529}** characters too long! Please try again.`);
    this.Output.generic("Quote added, up for review");
    this.sender({
      "title": "New TypeAdd, " + message.author.tag + ", from " + source,
      "description": text,
      "footer": Embed.footer("Submitted: " + getISOtime(Date.now()) + ", " + text.length + " characters.")
    }, (quote) => {
      let typingentries = DataManager.getData("./typing_articles4.json") || [];
      let newentry = {
        "Source": source,
        "Text": text,
        "Submitter": message.author.tag,
        "SubmitterID": message.author.id,
        "Quote": quote.id,
        "Approved": false
      };
      if(typingentries[0]) {
        typingentries.push(newentry)
      } else {
        typingentries[0] = newentry;
      };
      DataManager.setData(typingentries, "./typing_articles4.json");
      return quote;
    })
    .then(quote => {
      quote.react(getemojifromname("true"));
      setTimeout(() => {
        quote.react(getemojifromname("false"));
      }, 500);
      let quoteinfo = {
        "channel": quote.channel.id,
        "message": quote.id,
        "author": message.author.id,
        "emoji1": true,
        "event1": "true",
        "emoji2": "false",
        "event2": "false"
      };
      if(!server.ticketsv2 || !server.ticketsv2[0]) {
        server.ticketsv2 = [];
        server.ticketsv2[0] = quoteinfo;
      } else {
        server.ticketsv2.push(quoteinfo);
      };
      DataManager.setGuildData(server);
      return [quote, quoteinfo];
    })
    .then(([quote, quoteinfo]) => {
      let reactionsfilter = (reaction, user) => (reaction.emoji.name === "true" || reaction.emoji.name === "false") && !user.bot;
      let collector = quote.createReactionCollector(reactionsfilter, {
        "max": 1,
      })
      collector.on("collect", (collected) => {
        if(collected.emoji.name === "true") {
          emojiListener.emit("true", quoteinfo);
          return;
          };
        if(collected.emoji.name === "false") {
          emojiListener.emit("false", quoteinfo);
          return;
        };
      });
      collector.on("end", (collected)  => {
        quote.clearReactions();
      })
    })
    .catch(`Some error somewhere.`)
  }
}

module.exports = ModMail;

Date.gettime = function(ms) {
  let time = new Date(ms);
  time.hours = time.getUTCHours();
  time.minutes = time.getUTCMinutes();
  time.seconds = time.getUTCSeconds();
  time.milliseconds = time.getUTCMilliseconds();
  time.days = Math.floor(time.hours/24);
  time.hours = time.hours - (24 * time.days);
  return time;
};

Date.getISOtime = function(ms) {
  return Date.gettime(ms).toString().slice(0, 24); 
};