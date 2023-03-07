// <nowiki>

const AntiVandalVersion = 1;
const AntiVandalVersionDate = "2023-03-07";
const AntiVandalChangelog = [
	"Split \"report\" into two tabs: \"AIV\" and \"UAA\".",
	"Added ability to view diffs from user contributions and page history tabs.",
	"Added links to the diff and page history in the top toolbar.",
	"Small visual changes; for example, edit tags are now visible in the user contributions and history tabs.",
	"There are now statistics for the number of edits you have reviewed and reverted. These are stored locally, so they will not be accurate if you use AntiVandal on multiple devices. They can be accessed in the settings menu.",
	"Various bugfixes.",
	"This update completely rewrote the code, so there are likely to be bugs. If you find any, please let me know!",
	"If you have any suggestions, feel free to post them at <a href=\"https://en.wikipedia.org/wiki/Wikipedia talk:AntiVandal\" target=\"_blank\">Wikipedia talk:AntiVandal</a>."
];

class AntiVandal {
	constructor() {
		this.options = this.loadOptions();
		this.statistics = this.loadStats();
		this.interface = new AntiVandalInterface();
		this.queue = new AntiVandalQueue();
		this.api = new AntiVandalAPI(new mw.Api());
		this.logger = new AntiVandalLog();
		this.util = new AntiVandalUtil();

		this.aivReports = [];
		this.uaaReports = [];

		this.rollbackEnabled = mw.config.values.wgUserGroups.includes("sysop") || mw.config.values.wgUserGroups.includes("rollbacker");
		this.username = mw.config.values.wgUserName;
		this.handleLoadingReported();
	}

	/**
	 * Create the interface for checking if the user is allowed to use AntiVandal
	 */
	startInterface() {
		this.interface.build();
	}

	/**
	 * Create the main interface
	 */
	start() {
		this.interface.start();
		this.queue.fetchRecentChanges();
	}

	/**
	 * Load options from storage; if an option is missing, add it with the default value
	 * @returns {Object} The options object
	 */
	loadOptions() {
		let options = {};
		try {
			options = JSON.parse(mw.storage.store.getItem("AntiVandalSettings"));
		} catch (err) {}

		if (!options) {
			options = {};
		}

		for (const item in antiVandalData.defaultSettings) {
			if (typeof options[item] === "undefined") {
				options[item] = antiVandalData.defaultSettings[item];
			}

			if (typeof options[item] === "object") {
				for (const subitem in antiVandalData.defaultSettings[item]) {
					if (typeof options[item][subitem] === "undefined") {
						options[item][subitem] = antiVandalData.defaultSettings[item][subitem];
					}
				}
			}
		}

		this.saveOptions(options);
		return options;
	}

	/**
	 * Save options to storage
	 * @param {Object} options The options object
	 */
	saveOptions(options) {
		mw.storage.store.setItem("AntiVandalSettings", JSON.stringify(options));
	}

	/**
	 * Load the changelog version from storage
	 * @returns {String} The changelog version
	 */
	changelogVersion() {
		const version = mw.storage.store.getItem("AntiVandalChangelogVersion");

		if (!version) {
			mw.storage.store.setItem("AntiVandalChangelogVersion", 0);
			return 0;
		}

		return version;
	}

	/**
	 * Load statistics from storage
	 * @returns {Object} The statistics object
	 */
	loadStats() {
		let stats;
		try {
			stats = JSON.parse(mw.storage.store.getItem("AntiVandalStats"));
		} catch (err) {}

		if (!stats) {
			stats = { reviewed: 0, reverts: 0, reports: 0 };
		}

		this.saveStats(stats);
		return stats;
	}

	/**
	 * Save statistics to storage
	 * @param {Object} stats The statistics object
	 */
	saveStats(stats) {
		mw.storage.store.setItem("AntiVandalStats", JSON.stringify(stats));
	}

	/**
	 * Revert an edit, using either rollback or manual reverting
	 * @param {Object} edit The edit object
	 * @param {String} warning The warning template to use
	 * @param {String} message Message to use in the edit summary
	 */
	async revert(edit, warning, message) {
		if (!edit) {
			return;
		}

		const progressBar = new AntiVandalProgressBar();
		progressBar.set("Reverting...", "0%", "blue");
		const summary = `Reverted edits by [[Special:Contributions/${edit.user.name}|${edit.user.name}]] ([[User talk:${edit.user.name}|talk]])${message ? ": " + message : ""} ([[WP:AntiVandal|AV]])`;
		if (this.rollbackEnabled) {
			const result = await this.api.rollback(edit.page.title, edit.user.name, summary);

			if (!result) {
				progressBar.set("Edit conflict", "100%", "rgb(60, 220, 60)");
				return;
			}
		} else {
			const history = await this.api.history(edit.page.title);

			let content;

			for (const revision of history) {
				if (revision.user !== edit.user.name) {
					content = await this.api.getTextByRevid(revision.revid);
					break;
				}
			}

			if (!content) {
				progressBar.set("Failed to load", "100%", "rgb(255, 60, 60)");
				return;
			}

			const response = await this.api.edit(edit.page.title, content, summary, {
				baserevid: edit.revid,
				nocreate: 1
			});

			if (!response) {
				progressBar.set("Edit conflict", "100%", "rgb(60, 220, 60)");
				return;
			}

			const newHistory = await this.api.history(edit.page.title);

			if (newHistory[0].user !== this.username) {
				progressBar.set("Edit conflict", "100%", "rgb(60, 220, 60)");
				return;
			}
		}

		progressBar.set("Warning...", "50%", "rgb(0, 170, 255)");

		this.statistics.reverts++;
		this.saveStats(this.statistics);
		await this.warnUser(edit.user.name, warning, edit.page.title, edit.revid);
		progressBar.set("Done", "100%", "rgb(0, 170, 255)");
	}

	/**
	 * Warn a user with the given template
	 * @param {String} user The username to warn
	 * @param {String} warnTemplate The warning template to use
	 * @param {String} articleName The article name to use in the warning
	 */
	async warnUser(user, warnTemplate, articleName, revid) {
		if (!warnTemplate) {
			return;
		}

		let userTalkContent = (await this.api.getText(`User talk:${user}`))[`User talk:${user}`];
		if (warnTemplate === "auto") {
			const warningLevel = await this.queue.getWarningLevel(userTalkContent);
			if (warningLevel === "4" || warningLevel === "4im") {
				return;
			}
			warnTemplate = `subst:uw-vandalism${Number(warningLevel) + 1}`;
		}

		if (!userTalkContent.match("== ?" + antiVandal.util.monthSectionName() + " ?==")) {
			userTalkContent += `\n== ${antiVandal.util.monthSectionName()} ==\n`;
		}

		const sections = userTalkContent.split(/(?=== ?[\w\d ]+ ?==)/g);

		for (let section in sections) {
			if (sections[section].match(new RegExp("== ?" + antiVandal.util.monthSectionName() + " ?=="))) {
				sections[section] += `\n\n{{${warnTemplate}|${articleName}}} ~~~~`;
			}
		}

		const newContent = sections.join("")
			.replace(/(\n){3,}/g, "\n\n");

		const warnLevel = warnTemplate.match(/(\d(?:im)?)$/)[1];
		await this.api.edit(`User talk:${user}`, newContent, `Message about [[Special:Diff/${revid}|your edit]] on [[${articleName}]] (level ${warnLevel}) ([[WP:AntiVandal|AV]])`);
	}

	/**
	 * Load the users currently reported to AIV and UAA
	 */
	async loadReportedUsers() {
		const content = await this.api.getText("Wikipedia:Administrator intervention against vandalism|Wikipedia:Usernames for administrator attention");

		const regex = new RegExp(`{{(?:(?:ip)?vandal|user-uaa)\\|(?:1=)?(.+?)}}`, "gi");
		this.aivReports = [...content["Wikipedia:Administrator intervention against vandalism"].matchAll(regex)]
			.map(report => report[1]);
		this.uaaReports = [...content["Wikipedia:Usernames for administrator attention"].matchAll(regex)]
			.map(report => report[1]);
	}

	/**
	 * Every 15 seconds, call loadReportedUsers
	 */
	async handleLoadingReported() {
		await this.loadReportedUsers();

		window.setTimeout(() => {
			this.handleLoadingReported();
		}, 15000);
	}

	/**
	 * Check if a user is reported to AIV
	 * @param {String} name The username to check
	 * @param {Boolean} recheck Whether to recheck the reports
	 * @returns {Boolean} Whether the user is reported to AIV
	 */
	async userReportedToAiv(name, recheck=true) {
		if (recheck) {
			await this.loadReportedUsers();
		}

		return this.aivReports.some((report) => report.toLowerCase() === name.toLowerCase());
	}

	/**
	 * Check if a user is reported to UAA
	 * @param {String} name The username to check
	 * @param {Boolean} recheck Whether to recheck the reports
	 * @returns {Boolean} Whether the user is reported to UAA
	 */
	async userReportedToUaa(name, recheck=true) {
		if (recheck) {
			await this.loadReportedUsers();
		}

		return this.uaaReports.some((report) => report.toLowerCase() === name.toLowerCase());
	}

	/**
	 * Report a user to AIV
	 * @param {String} name The username to report
	 * @param {String} message The message to use in the report
	 */
	async reportToAIV(user, message) {
		const progressBar = new AntiVandalProgressBar();
		progressBar.set("Reporting...", "0%", "rgb(0, 170, 255)");
		const blocked = await this.api.usersBlocked(user.name);

		if (blocked[user.name]) {
			progressBar.set("Already blocked", "100%", "rgb(0, 170, 255)");
			return;
		}

		if (await this.userReportedToAiv(user.name)) {
			progressBar.set("Already reported", "100%", "rgb(0, 170, 255)");
			return;
		}

		let content = await this.api.getText("Wikipedia:Administrator intervention against vandalism");
		content = content["Wikipedia:Administrator intervention against vandalism"];
		content += `\n* {{vandal|${user.name}}} &ndash; ${message} ~~~~`;

		await this.api.edit("Wikipedia:Administrator intervention against vandalism", content, `Reporting [[Special:Contributions/${user.name}|${user.name}]] ([[WP:AntiVandal|AV]])`);
		progressBar.set("Reported", "100%", "rgb(0, 170, 255)");

		this.statistics.reports++;
		this.saveStats(this.statistics);

		antiVandal.interface.elem("past-final-warning").checked = true;
	}

	/**
	 * Report a user to UAA
	 * @param {String} name The username to report
	 * @param {String} message The message to use in the report
	 */
	async reportToUAA(user, message) {
		const progressBar = new AntiVandalProgressBar();
		progressBar.set("Reporting...", "0%", "rgb(0, 170, 255)");
		const blocked = await this.api.usersBlocked(user.name);

		if (blocked[user.name]) {
			progressBar.set("Already blocked", "100%", "rgb(0, 170, 255)");
			return;
		}

		if (await this.userReportedToUaa(user.name)) {
			progressBar.set("Already reported", "100%", "rgb(0, 170, 255)");
			return;
		}

		let content = await this.api.getText("Wikipedia:Usernames for administrator attention");
		content = content["Wikipedia:Usernames for administrator attention"];
		content += `\n* {{user-uaa|${user.name}}} &ndash; ${message} ~~~~`;

		await this.api.edit("Wikipedia:Usernames for administrator attention", content, `Reporting [[Special:Contributions/${user.name}|${user.name}]] ([[WP:AntiVandal|AV]])`);
		progressBar.set("Reported", "100%", "rgb(0, 170, 255)");

		this.statistics.reports++;
		this.saveStats(this.statistics);

		antiVandal.interface.elem("uaa-misleading").checked = true;
	}

	/**
	 * Handle a keypress
	 * @param {Object} event The keypress event
	 */
	keyPressed(event) {
		if (document.activeElement.tagName.toLowerCase() === "input") {
			return;
		}

		if (event.ctrlKey || event.altKey || event.metaKey) {
			return;
		}

		if (this.options.controls.next.includes(event.key.toLowerCase())) {
			this.queue.nextItem();
		}

		if (this.options.controls.previous.includes(event.key.toLowerCase())) {
			this.queue.prevItem();
		}

		if (this.options.controls.vandalism.includes(event.key.toLowerCase())) {
			this.revert(this.queue.currentEdit, "auto");
			this.queue.nextItem();
		}

		if (this.options.controls.rollback.includes(event.key.toLowerCase())) {
			this.revert(this.queue.currentEdit);
			this.queue.nextItem();
		}

		if (event.key === " ") {
			event.preventDefault();
		}
	}

	/**
	 * Called when the user clicks on a revert button for a specific template
	 * @param {String} template The template to revert with
	 * @param {Number} level The level of the template to revert with
	 */
	revertButton(template, level) {
		this.revert(this.queue.currentEdit, antiVandalData.warnings[template].templates[level]);
		this.queue.nextItem();

		const toolbarItems = [...document.querySelectorAll(".diffActionItem")];

		toolbarItems.forEach((item) => item.style.background = "");
		[...document.querySelectorAll(".diffActionBox")].forEach(e => e.style.display = "none");
	}
}

class AntiVandalInterface {
	constructor() {}

	/**
	 * Create the starting interface
	 * @returns {Boolean} Whether the user is allowed to use AntiVandal
	 */
	async build() {
		let allowed = antiVandal.rollbackEnabled;

		document.head.innerHTML = `
			<title>AntiVandal</title>
			${antiVandalData.initialStyle}
		`;

		document.body.innerHTML = antiVandalData.initialContent;
		this.elem(".rights").style.color = allowed ? "green" : "red";

		const whitelistContent = await antiVandal.api.getText("User:Ingenuity/AntiVandalWhitelist.json");
		const whitelist = JSON.parse(whitelistContent["User:Ingenuity/AntiVandalWhitelist.json"]).users;

		if (whitelist.includes(antiVandal.username)) {
			allowed = true;
			this.elem(".whitelist").style.color = "green";
		}

		this.elem(".start").disabled = !allowed;

		return allowed;
	}

	/**
	 * Create the main interface
	 */
	start() {
		document.head.innerHTML = antiVandalData.style;
		document.body.innerHTML = antiVandalData.content;

		this.elem("#queueForward").addEventListener("click", () => antiVandal.queue.nextItem());
		this.elem("#queueBack").addEventListener("click", () => antiVandal.queue.prevItem());
		this.elem("#queueDelete").addEventListener("click", () => antiVandal.queue.delete());

		const toolbarItems = [...document.querySelectorAll(".diffActionItem")];

		[...document.querySelectorAll(".diffActionBox")].forEach(e => {
			e.onclick = (event) => event.stopPropagation()
		});	

		toolbarItems.forEach((item) => {
			item.addEventListener("click", () => {
				let shouldReturn = item.style.background !== "";
				toolbarItems.forEach((item) => item.style.background = "");
				[...document.querySelectorAll(".diffActionBox")].forEach(e => e.style.display = "none");
				if (shouldReturn) {
					return;
				}
				item.style.background = "#ddd";
				item.querySelector(".diffActionBox").style.display = "initial";
			});
		});

		this.createWarningTable(antiVandalData.warnings, this.elem(".diffWarningsContainer"));

		this.elem(".aiv-button").addEventListener("click", () => {
			let message = "";
			if (this.elem("#past-final-warning").checked) {
				message = "Vandalism past final warning.";
			} else if (this.elem("#vandalism-only-acc").checked) {
				message = "Evidently a vandalism-only account.";
			} else if (this.elem("#other-reason").checked) {
				message = this.elem("#report-reason").value;
			}		
			antiVandal.reportToAIV(antiVandal.queue.currentEdit.user, message);
			this.elem("#report-reason").value = "";

			toolbarItems.forEach((item) => item.style.background = "");
			[...document.querySelectorAll(".diffActionBox")].forEach(e => e.style.display = "none");
		});

		this.elem(".uaa-button").addEventListener("click", () => {
			let message = "";
			if (this.elem("#uaa-misleading").checked) {
				message = "Violation of the username policy as a misleading username.";
			} else if (this.elem("#uaa-promotional").checked) {
				message = "Violation of the username policy as a promotional username.";
			} else if (this.elem("#uaa-disruptive").checked) {
				message = "Violation of the username policy as a disruptive username.";
			} else if (this.elem("#uaa-offensive").checked) {
				message = "Violation of the username policy as an offensive username.";
			} else if (this.elem("#uaa-other").checked) {
				message = this.elem("#uaa-reason").value;
			}
			antiVandal.reportToUAA(antiVandal.queue.currentEdit.user, message);
			this.elem("#uaa-reason").value = "";

			toolbarItems.forEach((item) => item.style.background = "");
			[...document.querySelectorAll(".diffActionBox")].forEach(e => e.style.display = "none");
		});

		this.elem("#revert-button").addEventListener("click", () => {
			antiVandal.revert(antiVandal.queue.currentEdit, "", this.elem("#revert-summary").value);
			antiVandal.queue.nextItem();
			this.elem("#revert-summary").value = "";

			toolbarItems.forEach((item) => item.style.background = "");
			[...document.querySelectorAll(".diffActionBox")].forEach(e => e.style.display = "none");
		});

		this.elem("#settings").addEventListener("click", () => {
			this.showSettings();
		});

		this.elem("#report-reason").addEventListener("click", () => {
			this.elem("#other-reason").checked = true;
		});

		this.elem("#uaa-reason").addEventListener("click", () => {
			this.elem("#uaa-other").checked = true;
		});

		this.showChangelog();
	}

	/**
	 * Create the changelog interface
	 */
	showChangelog() {
		if (antiVandal.changelogVersion() >= AntiVandalVersion) {
			return;
		}

		const changelogContainer = document.createElement("div");
		changelogContainer.classList.add("changelog");
		const changelogElem = document.createElement("div");
		changelogElem.classList.add("changelogContainer");
		const items = AntiVandalChangelog.map(e => `<li>${e}</li>`).join("");
		changelogContainer.appendChild(changelogElem);
		document.body.appendChild(changelogContainer);

		changelogElem.innerHTML = `
			<h1>Changelog &ndash; ${AntiVandalVersionDate}</h1>
			<ul>${items}</ul>
			<input name="showChangelog" id="showChangelog" type="checkbox" checked>
			<label for="showChangelog">Don't show again</label>
			<button onclick="antiVandal.interface.closeChangelog()">Close</button>
		`;
	}

	/**
	 * Close the changelog interface
	 */
	closeChangelog() {
		if (this.elem("#showChangelog").checked) {
			mw.storage.store.setItem("AntiVandalChangelogVersion", AntiVandalVersion);
		}

		document.body.removeChild(this.elem(".changelog"));
	}

	/**
	 * Render the queue, and call renderDiff on the current item
	 * @param {Array} queue The queue to render
	 * @param {Object} current The current item in the queue
	 */
	renderQueue(queue, current) {
		const queueContainer = this.elem(".queueItemsContainer");
		queueContainer.innerHTML = "";

		antiVandal.interface.elem("#queueItems").innerHTML = `(${queue.length} item${queue.length === 1 ? "" : "s"})`;

		queue.forEach((item) => {
			this.renderQueueItem(queueContainer, item, item.revid === current.revid);
		});

		if (queue.length === 0) {
			antiVandal.interface.elem(".queueStatus").innerHTML = "Loading more items...";
			antiVandal.interface.elem(".queueStatus").style.display = "block";
		}

		this.renderDiff(current);

		this.elem(".aiv-button").disabled = current === null;
		this.elem(".uaa-button").disabled = current === null;
	}

	/**
	 * Generate the item HTML for the queue, history, and user contributions
	 * @param {Object} item The item to generate the HTML for
	 * @param {String} title The title of the item
	 * @param {String} user The user who made the edit
	 * @param {Boolean} isSelected Whether the item is the currently selected edit
	 * @param {Object} showElements Whether to show the time, user, and title
	 * @returns {String} The HTML for the item
	 */
	generateItemHTML(item, title, user, isSelected, showElements, onclickFunction) {
		if (!item["tags"]) {
			item["tags"] = [];
		}

		const tagHTML = item.tags
			.reduce((acc, tag) => acc + `<span class="queueItemTag" title="${antiVandal.util.escapeHtml(tag)}">${tag}</span>`, "");
		
		let oresColor, oresText;
		if (item["ores"]) {
			[ oresColor, oresText ] = this.getORESColor(item["ores"]);
		}
		const oresHTML = item["ores"] ? `<div class="ores ores-${oresColor}" title="ORES score of ${Math.floor(item.ores * 100) / 100}; ${oresText}"></div>` : "";

		const timeHTML = showElements.time ? `
			<a class="infoItemTitle infoItemTime" title="${item.timestamp}">
				<span class="fas fa-clock"></span>${antiVandal.util.timeAgo(item.timestamp)}
			</a>
		` : "";

		let userHTML;

		if (user) {
			userHTML = showElements.user ? `
				<a class="queueItemUser" href="${antiVandal.util.pageLink(`Special:Contributions/${user}`)}" target="_blank" title="User:${user}">
					<span class="fas fa-user"></span>${antiVandal.util.maxStringLength(user, 25)}
				</a>
			` : "";
		} else {
			userHTML = showElements.user ? `
				<a class="queueItemUser" title="Username hidden">
					<span class="fas fa-user"></span>Username hidden
				</a>
			` : "";
		}

		const titleHTML = showElements.title ? `
			<a class="queueItemTitle" href="${antiVandal.util.pageLink(title)}" target="_blank" title="${title}">
				<span class="fas fa-file-lines"></span>${title}
			</a>
		` : "";

		return `
			<div class="queueItem${isSelected ? " currentQueueItem" : ""}" onclick="${onclickFunction}">
				${titleHTML}
				${userHTML}
				<a class="infoItemTitle" title="${antiVandal.util.escapeHtml(item.comment || "") || "No edit summary"}">
					<span class="fas fa-comment-dots"></span>${antiVandal.util.escapeHtml(item.comment || "") || "<em>No edit summary</em>"}
				</a>
				${timeHTML}
				<div class="queueItemChange" style="color: ${antiVandal.util.getChangeColor(item.sizediff || 0)};">
					<span class="queueItemChangeText">${antiVandal.util.getChangeString(item.sizediff || 0)}</span>
				</div>
				<div class="queueItemTags">
					${tagHTML}
				</div>
				${oresHTML}
			</div>
		`;
	}

	/**
	 * From the ORES score, get the color and text to display
	 * @param {Number} ores The ORES score
	 * @returns {Array} The color and text to display
	 */
	getORESColor(ores) {
		if (ores > 0.65) {
			return ["red", "very likely vandalism"];
		}

		if (ores > 0.6) {
			return ["orange", "likely vandalism"];
		}

		if (ores > 0.5) {
			return ["yellow", "possible vandalism"];
		}

		return ["grey", "likely not vandalism"]
	}

	/**
	 * Render the diff for the current edit, along with the history and user contributions
	 * @param {Object} edit The edit to render
	 */
	async renderDiff(edit) {
		const diffContainer = this.elem(".diffChangeContainer");
		const toolbar = this.elem(".diffToolbar");
		const userContribsContainer = this.elem(".userContribs");
		const pageHistoryContainer = this.elem(".pageHistory");
		const editCountContainer = this.elem(".infoEditCount");
		const warnLevelContainer = this.elem(".infoWarnLevel");

		diffContainer.style.height = "auto";

		if (edit === null) {
			diffContainer.style.height = "calc(100% - 100px)";
			diffContainer.innerHTML = `<div style="width: 100%; height: 100%; display: flex; justify-content: center; align-items: center;">Loading more results...</div>`;
			toolbar.innerHTML = "";
			userContribsContainer.innerHTML = "";
			pageHistoryContainer.innerHTML = "";
			editCountContainer.innerHTML = "Count: ";
			warnLevelContainer.innerHTML = "Warn level: ";
			return;
		}

		userContribsContainer.innerHTML = edit.user.contribs
			.map((contrib) => this.generateItemHTML(contrib, contrib.title, "", contrib.revid === edit.revid, {
				time: true,
				user: false,
				title: true
			}, `antiVandal.queue.loadFromContribs(${contrib.revid})`))
			.join("");

		pageHistoryContainer.innerHTML = edit.page.history
			.map((history) => this.generateItemHTML(history, history.title, history.user, history.revid === edit.revid, {
				time: true,
				user: true,
				title: false
			}, `antiVandal.queue.loadFromHistory(${history.revid})`))
			.join("");
		
		const summary = antiVandal.util.escapeHtml(antiVandal.util.maxStringLength(edit.comment, 100));
		
		toolbar.innerHTML = `
			<span class="diffToolbarItem">
				<span class="fas fa-file-lines"></span>
				<a href="${antiVandal.util.pageLink(edit.page.title)}" target="_blank" title="${antiVandal.util.escapeHtml(edit.page.title)}">${antiVandal.util.escapeHtml(antiVandal.util.maxStringLength(edit.page.title, 40))}</a>
				<a style="font-weight: initial;" href="${antiVandal.util.pageLink(antiVandal.util.escapeHtml("Special:PageHistory/" + edit.page.title))}" target="_blank">(history)</a>
			</span>
			<span class="diffToolbarItem">
				<span class="fas fa-user"></span>
				<a href="${antiVandal.util.pageLink("User:" + edit.user.name)}" title="${antiVandal.util.escapeHtml(edit.user.name)}" target="_blank">${antiVandal.util.maxStringLength(edit.user.name, 30)}</a>&nbsp;
				<span class="unbold">
					(<a href="${antiVandal.util.pageLink("User talk:" + edit.user.name)}" target="_blank">talk</a> &bull; <a href="${antiVandal.util.pageLink("Special:Contributions/" + edit.user.name)}" target="_blank">contribs</a>)
				</span>
			</span>
			<span class="diffToolbarItem">
				<span class="fas fa-pencil"></span>
				<span style="color: ${antiVandal.util.getChangeColor(edit.sizediff)};">${antiVandal.util.getChangeString(edit.sizediff)}</span>
				<a style="font-weight: initial;" href="${antiVandal.util.pageLink("Special:Diff/" + edit.revid)}" target="_blank">(diff)</a>
			</span>
			<div class="diffToolbarOverlay">
				<span title="${antiVandal.util.escapeHtml(edit.comment)}">${summary}</span>
			</div>
		`;

		if (!edit.diff) {
			diffContainer.style.height = "calc(100% - 100px)";
			diffContainer.innerHTML = `<div style="width: 100%; height: 100%; display: flex; justify-content: center; align-items: center;">Could not load diff</div>`;
		} else {
			diffContainer.innerHTML = `<table>${edit.diff}</table>`;
		}
		editCountContainer.style.display = edit.user.editCount === -1 ? "none" : "initial";
		editCountContainer.innerHTML = `Count: ${edit.user.editCount}`;
		warnLevelContainer.innerHTML = `Warn level: ${edit.user.warningLevel}`;

		const aivIcon = this.elem("#aivReportIcon");
		const uaaIcon = this.elem("#uaaReportIcon");

		aivIcon.style.display = "none";
		uaaIcon.style.display = "none";

		if (edit.user.warningLevel === "4" || edit.user.warningLevel === "4im") {
			aivIcon.style.display = "inline";
			aivIcon.style.color = "red";
		}

		if (await antiVandal.userReportedToAiv(edit.user.name, false)) {
			aivIcon.style.display = "inline";
			aivIcon.style.color = "black";
		}

		if (await antiVandal.userReportedToUaa(edit.user.name, false)) {
			uaaIcon.style.display = "inline";
			uaaIcon.style.color = "black";
		}

		const warningsContainer = this.elem(".diffWarningsContainer");
		if (this.elem("#diffWarn")) {
			this.elem("#diffWarn").remove();
		}
		let html = "<tbody id='diffWarn'><tr><td></td>";
		const warnLevels = ["0", "1", "2", "3", "4", "4im"];
		for (let i = 1; i < 6; i++) {
			if (edit.user.warningLevel === warnLevels[i - 1]) {
				html += `<td class='centered' title="User's current warning level"><span class='fas fa-caret-down'></span></td>`;
			} else {
				html += "<td></td>";
			}
		}
		warningsContainer.innerHTML = html + "</tr></tbody>" + warningsContainer.innerHTML;
	}

	/**
	 * Render a single edit to the queue
	 * @param {HTMLElement} container The container to render the edit to
	 * @param {Object} item The edit to render
	 * @param {Boolean} isSelected Whether the edit is selected
	 */
	renderQueueItem(container, item, isSelected) {
		container.innerHTML += this.generateItemHTML(item, item.page.title, item.user.name, isSelected, {
			time: false,
			user: true,
			title: true
		});
	}

	/**
	 * Fetch a single edit with the given selector
	 * @param {String} selector The selector to fetch the element
	 * @returns {HTMLElement} The element
	 */
	elem(selector) {
		return document.querySelector(selector);
	}

	/**
	 * Create the table of warnings
	 * @param {Array} warnings List of warnings
	 * @param {HTMLElement} warningsContainer The container to render the warnings to
	 */
	createWarningTable(warnings, warningsContainer) {
		for (let item in warnings) {
			const templates = document.createElement("tr");
			let html = `<td><span class="diffWarningLabel">${item}</span></td>`;
			for (let i = 0; i < warnings[item].templates.length; i++) {
				html += `<td><span
					class="diffWarning warningLevel${i + 1}"
					title="${warnings[item].templates[i]}"
					onclick="antiVandal.revertButton('${item}', ${i})">${i === 4 ? "4im" : i + 1}</span></td>`;
			}
			if (warnings[item].templates.length === 4) {
				html += "<td></td>";
			}
			templates.innerHTML = html + "<td><span class='fas fa-circle-question reason-explanation' title='" + warnings[item].desc + "'></span></td>";
			warningsContainer.appendChild(templates);
		}
	}

	/**
	 * Show the settings menu, and load the settings into inputs
	 */
	showSettings() {
		this.elem(".settings").style.display = "flex";

		this.elem("input[name=queueUsersCount]").value = antiVandal.options.maxEditCount;
		this.elem("input[name=queueMaxSize]").value = antiVandal.options.maxQueueSize;
		this.elem("input[name=namespaceMain]").checked = antiVandal.options.namespaces.main;
		this.elem("input[name=namespaceUser]").checked = antiVandal.options.namespaces.user;
		this.elem("input[name=namespaceDraft]").checked = antiVandal.options.namespaces.draft;
		this.elem("input[name=namespaceWikipedia]").checked = antiVandal.options.namespaces.wikipedia;
		this.elem("input[name=namespaceOther]").checked = antiVandal.options.namespaces.other;
		this.elem("input[name=minORES]").value = antiVandal.options.minimumORESScore;
		this.elem("label[for=minORES]").innerText = antiVandal.options.minimumORESScore;

		this.elem("input[name=minORES]").oninput = function() {
			antiVandal.interface.elem("label[for=minORES]").innerText = this.value;
		}

		const stats = antiVandal.loadStats();
		this.elem("#statistics").innerHTML = `Total of ${stats.reviewed} reviewed and ${stats.reverts} reverted edits (${Math.floor(stats.reverts / (stats.reverts + stats.reviewed) * 1000) / 10}% revert rate), plus ${stats.reports} reports.`;
	}

	/*
	 * Save the settings
	 */
	saveSettings() {
		antiVandal.options.maxEditCount = parseInt(this.elem("input[name=queueUsersCount]").value);
		antiVandal.options.maxQueueSize = parseInt(this.elem("input[name=queueMaxSize]").value);
		antiVandal.options.namespaces.main = this.elem("input[name=namespaceMain]").checked;
		antiVandal.options.namespaces.user = this.elem("input[name=namespaceUser]").checked;
		antiVandal.options.namespaces.draft = this.elem("input[name=namespaceDraft]").checked;
		antiVandal.options.namespaces.wikipedia = this.elem("input[name=namespaceWikipedia]").checked;
		antiVandal.options.namespaces.other = this.elem("input[name=namespaceOther]").checked;
		antiVandal.options.minimumORESScore = parseFloat(this.elem("input[name=minORES]").value);

		antiVandal.saveOptions(antiVandal.options);
		this.hideSettings();
	}

	/**
	 * Hide the settings menu
	 */
	hideSettings() {
		this.elem(".settings").style.display = "none";
	}
}

class AntiVandalQueue {
	constructor() {
		this.queue = [];
		this.previousItems = [];
		this.editsSince = "";
		this.lastRevid = 0;
		this.currentEdit = null;
	}

	/**
	 * Fetch recent changes from the API
	 */
	async fetchRecentChanges() {
		if (this.queue.length >= antiVandal.options.maxQueueSize) {
			window.setTimeout(this.fetchRecentChanges.bind(this), antiVandal.options.refreshTime);
			antiVandal.interface.elem(".queueStatus").innerHTML = "Queue full";
			antiVandal.interface.elem(".queueStatus").style.display = "block";
			return;
		}

		this.editsSince = antiVandal.util.utcString(new Date());

		const recentChanges = (await antiVandal.api.recentChanges(antiVandal.util.getNamespaceString(antiVandalData.namespaces)))
			.filter(edit => edit.revid > this.lastRevid);
		
		this.lastRevid = Math.max(...recentChanges.map(edit => edit.revid));
		
		const usersToFetch = recentChanges
			.map(edit => mw.util.isIPv6Address(edit.user) ? edit.user.toUpperCase() : edit.user);
		
		const editCounts = (await antiVandal.api.editCount(usersToFetch.join("|")))
			.filter(user => user["invalid"] || user["editcount"] <= antiVandal.options.maxEditCount);

		const dict = editCounts
			.reduce((a, v) => ({...a, [v.name]: v.editcount}), {});
		
		const warnings = (await antiVandal.api.getText(
			usersToFetch.map(user => `User_talk:${user}`).join("|")
		));

		const blocks = await antiVandal.api.usersBlocked(usersToFetch.join("|"));

		const ores = (await antiVandal.api.ores(recentChanges.map(edit => edit.revid).join("|")));

		recentChanges
			.filter(edit => edit.user in dict)
			.filter(edit => (ores[edit.revid] || 0) >= antiVandal.options.minimumORESScore)
			.forEach(edit => this.addQueueItem(
				edit,
				dict[edit.user] || -1,
				this.getWarningLevel(warnings[`User talk:${edit.user}`] || ""),
				ores[edit.revid] || 0,
				blocks[edit.user] || false
			));

		window.setTimeout(this.fetchRecentChanges.bind(this), antiVandal.options.refreshTime);
	}

	/**
	 * Add an edit to the queue
	 * @param {Object} edit The edit to add
	 * @param {Number} count The edit count of the user
	 * @param {String} warningLevel The warning level of the user
	 * @param {Number} ores The ORES score of the edit
	 * @param {Boolean} blocked Whether the user is blocked
	 */
	async addQueueItem(edit, count, warningLevel, ores, blocked) {
		if (this.queue.filter(e => e.revid === edit.revid).length > 0 ||
			this.previousItems.filter(e => e.revid === edit.revid).length > 0) {
			return;
		}
		
		const item = await this.generateQueueItem(edit, count, warningLevel, ores, blocked);

		this.queue.push(item);
		const sorted = this.queue.splice(1)
			.sort((a, b) => b.ores - a.ores);
		this.queue = [this.queue[0], ...sorted];

		if (this.queue.length === 1) {
			this.currentEdit = this.queue[0];
		}

		antiVandal.interface.elem(".queueStatus").style.display = "none";
		antiVandal.interface.renderQueue(this.queue, this.currentEdit);
	}

	/**
	 * Generate a queue item from an edit
	 * @param {Object} edit The edit to generate the queue item from
	 * @param {Number} count The edit count of the user
	 * @param {String} warningLevel The warning level of the user
	 * @param {Number} ores The ORES score of the edit
	 * @param {Boolean} blocked Whether the user is blocked
	 * @returns {Object} The queue item
	 */
	async generateQueueItem(edit, count, warningLevel, ores, blocked, contribs, history) {
		contribs = contribs || await antiVandal.api.contribs(edit.user);
		history = history || await antiVandal.api.history(edit.title);
		const diff = await antiVandal.api.diff(edit.title, edit.old_revid || edit.parentid, edit.revid);

		return {
			page: {
				title: edit.title,
				history: history
			},
			user: {
				name: edit.user,
				contribs: contribs,
				editCount: count,
				warningLevel: warningLevel,
				blocked: blocked
			},
			ores: ores,
			revid: edit.revid,
			timestamp: edit.timestamp,
			comment: edit.comment,
			sizediff: (edit["newlen"] ? edit.newlen - edit.oldlen : edit.sizediff) || 0,
			diff: diff,
			tags: edit.tags,
			reviewed: false
		};
	}

	/**
	 * Given the text of a user talk page, get the warning level of the user
	 * @param {String} text The text of the user talk page
	 * @returns {String} The warning level of the user
	 */
	getWarningLevel(text) {
		const monthSections = text.split(/(?=== ?[\w\d ]+ ?==)/g);

		for (let section of monthSections) {
			if (new RegExp("== ?" + antiVandal.util.monthSectionName() + " ?==").test(section)) {
				const templates = section.match(/<\!-- Template:[\w-]+?(\di?m?) -->/g);
				if (templates === null) {
					return "0";
				}
				const filteredTemplates = templates.map(t => {
					const match = t.match(/<\!-- Template:[\w-]+?(\di?m?) -->/);
					return match ? match[1] : "0";
				});
				return filteredTemplates.sort()[filteredTemplates.length - 1].toString();
			}
		}
	
		return "0";
	}

	/**
	 * Set the current edit to the next item in the queue
	 */
	nextItem() {
		if (this.queue.length === 0) {
			return;
		}

		if (!this.queue[0].reviewed) {
			this.queue[0].reviewed = true;
			antiVandal.statistics.reviewed += 1;
			antiVandal.saveStats(antiVandal.statistics);
		}

		this.previousItems.push(this.queue.shift());
		if (this.previousItems.length > 50) {
			this.previousItems.shift();
		}
		this.currentEdit = this.queue.length ? this.queue[0] : null;
		antiVandal.interface.renderQueue(this.queue, this.currentEdit);
	}

	/**
	 * Set the current edit to the previous item in the queue
	 */
	prevItem() {
		if (this.previousItems.length === 0) {
			return;
		}

		this.queue.unshift(this.previousItems.pop());
		this.currentEdit = this.queue[0];
		antiVandal.interface.renderQueue(this.queue, this.currentEdit);
	}

	/**
	 * Clear the queue
	 */
	delete() {
		this.queue = [];
		this.currentEdit = null;
		antiVandal.interface.renderQueue(this.queue, this.currentEdit);
	}

	async loadFromContribs(revid) {
		const edit = this.currentEdit.user.contribs.filter(e => e.revid === revid)[0];

		const diffContainer = antiVandal.interface.elem(".diffChangeContainer");
		diffContainer.style.height = "calc(100% - 100px)";
		diffContainer.innerHTML = `<div style="width: 100%; height: 100%; display: flex; justify-content: center; align-items: center;">Loading...</div>`;

		this.currentEdit = await this.generateQueueItem(edit, this.currentEdit.user.editCount, this.currentEdit.user.warningLevel, null, this.currentEdit.user.blocked);
		antiVandal.interface.renderQueue(this.queue, this.currentEdit);
	}

	async loadFromHistory(revid) {
		const edit = this.currentEdit.page.history.filter(e => e.revid === revid)[0];
		edit["title"] = this.currentEdit.page.title;

		const diffContainer = antiVandal.interface.elem(".diffChangeContainer");
		diffContainer.style.height = "calc(100% - 100px)";
		diffContainer.innerHTML = `<div style="width: 100%; height: 100%; display: flex; justify-content: center; align-items: center;">Loading...</div>`;

		const results = await Promise.all([
			antiVandal.api.editCount(edit.user),
			antiVandal.api.getText(`User talk:${edit.user}`),
			antiVandal.api.contribs(edit.user),
			antiVandal.api.history(edit.title)
		]);

		this.currentEdit = await this.generateQueueItem(edit, results[0][0].editcount, this.getWarningLevel(results[1][`User talk:${edit.user}`]), null, false, results[2], results[3]);
	}
}

class AntiVandalLog {
	constructor() {}

	/**
	 * Log a message to the console
	 * @param {String} text The message to log
	 */
	log(text) {
		console.log(`AntiVandal: ${text}`);
	}
}

class AntiVandalUtil {
	constructor() {}

	/**
	 * Create a string with chosen namespaces for use in the API
	 * @param {Array} list The list of namespaces to use
	 * @returns {String} The string of namespaces
	 */
	getNamespaceString(list) {
		return list
			.filter(item => antiVandal.options.namespaces[item.category])
			.map(item => item.id)
			.join("|");
	}

	/**
	 * Given a Date object, return a string in the format YYYY-MM-DDTHH:MM:SS
	 * @param {Date} date The date to convert
	 * @returns {String} The date in the format YYYY-MM-DDTHH:MM:SS
	 */
	utcString(date) {
		return date.getUTCFullYear() + "-" +
			this.padString(date.getUTCMonth() + 1, 2) + "-" +
			this.padString(date.getUTCDate(), 2) + "T" +
			this.padString(date.getUTCHours(), 2) + ":" +
			this.padString(date.getUTCMinutes(), 2) + ":" +
			this.padString(date.getUTCSeconds(), 2);
	}

	/**
	 * Given a string and a length, pad the string with 0s to the left until it is the given length
	 * @param {String} str The string to pad
	 * @param {Number} len The length to pad to
	 * @returns {String} The padded string
	 */
	padString(str, len) {
		str = str.toString();
		while (str.length < len) {
			str = "0" + str;
		}
		return str;
	}

	/**
	 * Given a string, encode it for use in a URL
	 * @param {String} str The string to encode
	 * @returns {String} The encoded string
	 */
	encodeuri(str) {
		return encodeURIComponent(str);
	}

	/**
	 * Get the section name for the current month and year
	 * @returns {String} The section name
	 */
	monthSectionName() {
		const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
		const currentMonth = months[new Date().getUTCMonth()];
		const currentYear = new Date().getUTCFullYear();

		return currentMonth + " " + currentYear;
	}

	/**
	 * Given a string, escape it for use in HTML
	 * @param {String} str The string to escape
	 * @returns {String} The escaped string
	 */
	escapeHtml(str) {
		return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
	}

	/**
	 * Given the title of a page, return the URL to that page
	 * @param {String} title The title of the page
	 * @returns {String} The URL to the page
	 */
	pageLink(title) {
		return `https://${antiVandal.options.wiki}.wikipedia.org/wiki/${this.encodeuri(title)}`;
	}

	/**
	 * If the given string is longer than the given length, truncate it and add "..." to the end
	 * @param {String} str The string to truncate
	 * @param {Number} len The length to truncate to
	 * @returns {String} The truncated string
	 */
	maxStringLength(str, len) {
		return str.length > len ? str.substring(0, len) + "..." : str;
	}

	/**
	 * Given the number of bytes changed in an edit, return the color
	 * @param {Number} delta The number of bytes changed
	 * @returns {String} The color
	 */
	getChangeColor(delta) {
		return delta > 0 ? "green" : (delta < 0 ? "red" : "black");
	}

	/**
	 * Given the number of bytes changed in an edit, return the string (eg. "+100")
	 * @param {Number} delta The number of bytes changed
	 * @returns {String} The string
	 */
	getChangeString(delta) {
		return delta > 0 ? "+" + delta : delta.toString();
	}

	/**
	 * Given a timestamp, return a string representing how long ago it was
	 * @param {String} timestamp The timestamp
	 * @returns {String} Time ago
	 */
	timeAgo(timestamp) {
		const difference = new Date().getTime() - new Date(timestamp);
		const seconds = Math.floor(difference / 1000);
	
		if (seconds > 60) {
			if (seconds > 60 * 60) {
				if (seconds > 60 * 60 * 24) {
					const val = Math.floor(seconds / 60 / 60 / 24);
					return val + " day" + (val !== 1 ? "s" : "") + " ago";
				}
				const val = Math.floor(seconds / 60 / 60);
				return val + " hour" + (val !== 1 ? "s" : "") + " ago";
			}
			const val = Math.floor(seconds / 60);
			return val + " minute" + (val !== 1 ? "s" : "") + " ago";
		}
		return seconds + " second" + (seconds !== 1 ? "s" : "") + " ago";
	}
}

class AntiVandalAPI {
	constructor(api) {
		this.api = api;
	}

	/**
	 * Edit the given page with the given content and summary
	 * @param {String} title The title of the page to edit
	 * @param {String} content The content to edit the page with
	 * @param {String} summary The edit summary
	 * @param {Object} params Any additional parameters to pass to the API
	 */
	async edit(title, content, summary, params={}) {
		try {
			await this.api.postWithEditToken(Object.assign({}, {
				"action": "edit",
				"title": title,
				"text": content,
				"summary": summary,
				"format": "json",
				"tags": "AntiVandal script"
			}, params));

			return true;
		} catch (err) {
			antiVandal.logger.log(`Could not edit page ${title}: ${err}`);
			return false;
		}
	}

	/**
	 * Get the content of the given pages
	 * @param {String} titles The titles of the pages to get, separated by "|"
	 * @returns {Object} The content of the pages
	 */
	async getText(titles) {
		try {
			const response = await this.api.get({
				"action": "query",
				"prop": "revisions",
				"titles": titles,
				"rvprop": "content",
				"rvslots": "*",
				"format": "json",
				"formatversion": 2
			});

			const pages = response.query.pages.map(page => {
				return [page["title"], page["missing"] ? "" : page.revisions[0].slots.main.content];
			});

			return pages
				.reduce((a, v) => ({...a, [v[0]]: v[1]}), {});
		} catch (err) {
			antiVandal.logger.log(`Could not fetch page ${titles}: ${err}`);
		}
	}

	/**
	 * Get the content of the given revision id
	 * @param {Number} revid The revision id to get
	 * @returns {String} The content of the revision
	 */
	async getTextByRevid(revid) {
		try {
			const response = await this.api.get({
				"action": "query",
				"prop": "revisions",
				"revids": revid,
				"rvprop": "content",
				"rvslots": "*",
				"format": "json",
				"formatversion": 2
			});

			const page = response.query.pages[0];
			return page["missing"] ? "" : page.revisions[0].slots.main.content;
		} catch (err) {
			antiVandal.logger.log(`Could not fetch page with revid ${revid}: ${err}`);
		}
	}

	/**
	 * Get the difference between two revisions of the given page
	 * @param {String} title The title of the page
	 * @param {Number} old_revid The old revision ID
	 * @param {Number} revid The new revision ID
	 * @returns {String} The difference between the two revisions, in HTML format
	 */
	async diff(title, old_revid, revid) {
		try {
			const response = await this.api.get({
				"action": "compare",
				"fromrev": old_revid,
				"torev": revid,
				"prop": "diff",
				"format": "json",
				"formatversion": 2
			});

			return response.compare.body;
		} catch (err) {
			antiVandal.logger.log(`Could not fetch diff for page ${title}: ${err}`);
		}
	}

	/**
	 * Get the contributions of the given user
	 * @param {String} user The user to get contributions for
	 * @returns {Array} The contributions
	 */
	async contribs(user) {
		try {
			const response = await this.api.get({
				"action": "query",
				"list": "usercontribs",
				"ucuser": user,
				"uclimit": 10,
				"ucprop": "title|ids|timestamp|comment|flags|sizediff|tags",
				"format": "json",
				"formatversion": 2
			});

			return response.query.usercontribs;
		} catch (err) {
			antiVandal.logger.log(`Could not fetch contributions for user ${user}: ${err}`);
		}
	}

	/**
	 * Get the edit count of the given users
	 * @param {String} users The users to get edit counts for, separated by "|"
	 * @returns {Array} The edit counts
	 */
	async editCount(users) {
		try {
			const response = await this.api.get({
				"action": "query",
				"list": "users",
				"ususers": users,
				"usprop": "editcount",
				"format": "json",
				"formatversion": 2
			});

			return response.query.users;
		} catch (err) {
			antiVandal.logger.log(`Could not fetch edit count for users ${users}: ${err}`);
		}
	}

	/**
	 * Get the filter log of the given user
	 * @param {String} user The user to get the filter log for
	 * @returns {Array} The filter log
	 */
	async filterLog(user) {
		try {
			const response = await this.api.get({
				"action": "query",
				"list": "logevents",
				"letype": "filter",
				"leuser": user,
				"lelimit": 50,
				"format": "json",
				"formatversion": 2
			});

			return response.query.logevents;
		} catch (err) {
			antiVandal.logger.log(`Could not fetch filter log for user ${user}: ${err}`);
		}
	}

	/**
	 * Get the history of the given page
	 * @param {String} page The page to get the history for
	 * @returns {Array} The history
	 */
	async history(page) {
		try {
			const response = await this.api.get({
				"action": "query",
				"prop": "revisions",
				"titles": page,
				"rvprop": "title|ids|timestamp|comment|flags|sizediff|user|tags|size",
				"rvlimit": 11,
				"format": "json",
				"formatversion": 2
			});

			const revisions = response.query.pages[0].revisions;

			for (let i = 0; i < Math.min(10, revisions.length); i++) {
				if (i + 1 < revisions.length) {
					revisions[i]["sizediff"] = revisions[i].size - revisions[i + 1].size;
				} else {
					revisions[i]["sizediff"] = revisions[i].size;
				}
			}

			return revisions.splice(0, 10);
		} catch (err) {
			antiVandal.logger.log(`Could not fetch history for page ${page}: ${err}`);
		}
	}

	/**
	 * Get recent edits to Wikipedia
	 * @param {String} namespaces The namespaces to get recent changes for, separated by "|"
	 * @param {String} since The timestamp to start from
	 * @returns {Array} The recent changes
	 */
	async recentChanges(namespaces, since) {
		try {
			const response = await this.api.get({
				"action": "query",
				"list": "recentchanges",
				"rcnamespace": namespaces,
				"rclimit": 50,
				"rcprop": "title|ids|sizes|flags|user|tags|comment|timestamp",
				"rctype": "edit",
				"format": "json",
				"rcstart": since || "",
				"rcdir": since ? "newer" : "older"
			});

			return response.query.recentchanges;
		} catch (err) {
			antiVandal.logger.log(`Could not fetch recent changes: ${err}`);
		}
	}

	/**
	 * Get the ORES scores for the given revisions
	 * @param {String} revids The revision IDs to get ORES scores for, separated by "|"
	 * @returns {Object} The ORES scores
	 */
	async ores(revids) {
		try {
			const response = await this.api.get({
				"action": "query",
				"format": "json",
				"formatversion": 2,
				"prop": "revisions",
				"revids": revids,
				"rvprop": "oresscores|ids",
				"rvslots": "*"
			});

			const scores = response.query.pages.map(page => {
				return ["goodfaith"] in page["revisions"][0]["oresscores"] ? [
					page["revisions"][0]["revid"],
					page["revisions"][0]["oresscores"]["goodfaith"]["false"]
				] : [ page["revisions"][0]["revid"], 0 ];
			});

			return scores
				.reduce((a, v) => ({...a, [v[0]]: v[1]}), {});
		} catch (err) {
			antiVandal.logger.log(`Could not fetch ORES scores for revision ${revids}: ${err}`);
		}
	}

	/**
	 * Check if the given users are blocked
	 * @param {String} users The users to get blocks for, separated by "|"
	 * @returns {Object} The blocks
	 */
	async usersBlocked(users) {
		try {
			const response = await this.api.get({
				"action": "query",
				"list": "blocks",
				"bkusers": users,
				"bkprop": "id|user|by|timestamp|expiry|reason",
				"format": "json",
				"formatversion": 2
			});

			const blocks = {};
			users.split("|").forEach(user => blocks[user] = false);
			response.query.blocks.forEach(block => blocks[block.user] = !block.partial);
			return blocks;
		} catch (err) {
			antiVandal.logger.log(`Could not fetch blocks for users ${users}: ${err}`);
		}
	}

	/**
	 * Rollback the user's edits
	 * @param {String} title The title of the page to rollback
	 * @param {String} user The user to rollback
	 * @param {String} summary The summary to use for the rollback
	 * @returns {Boolean} Whether the rollback was successful
	 */
	async rollback(title, user, summary) {
		try {
			await this.api.rollback(title, user, {
				"summary": summary
			});

			return true;
		} catch (err) {
			console.log(err);
			return false;
		}
	}
}

class AntiVandalProgressBar {
	constructor() {
		this.element = document.createElement("div");
		this.element.className = "diffProgressBar";

		this.overlay = document.createElement("div");
		this.overlay.className = "diffProgressBarOverlay";

		this.text = document.createElement("div");
		this.text.className = "diffProgressBarText";

		antiVandal.interface.elem(".diffProgressContainer").appendChild(this.element);
		this.element.appendChild(this.overlay);
		this.element.appendChild(this.text);
	}

	/**
	 * Set the progress bar's text, width, and color; remove after 2s if at 100%
	 * @param {String} text The text to display
	 * @param {String} width The width of the progress bar
	 * @param {String} color The color of the progress bar
	 */
	set(text, width, color) {
		this.text.innerHTML = text;
		this.overlay.style.width = width;
		this.overlay.style.background = color;

		if (width == "100%") {
			this.remove(2000);
		}
	}

	/**
	 * Remove the progress bar after a given time
	 * @param {Number} time The time to wait before removing the progress bar
	 */
	remove(time) {
		window.setTimeout(() => {
			this.element.style.opacity = "0";
		}, time - 300);

		window.setTimeout(() => {
			this.element.remove();
		}, time);
	}
}

const antiVandalData = {
	defaultSettings: {
		maxQueueSize: 50,
		maxEditCount: 50,
		minimumORESScore: 0,
		wiki: "en",
		namespaces: {
			main: true,
			draft: true,
			user: true,
			wikipedia: true,
			other: true
		},
		refreshTime: 2000,
		showIPs: true,
		showUsers: true,
		sortQueueItems: true,
		controls: {
			"vandalism": ["q"],
			"rollback": ["r"],
			"previous": ["[", "ArrowLeft"],
			"next": ["]", "ArrowRight", " "]
		}
	},
	warnings: {
		"Vandalism": {
			templates: [
				"subst:uw-vandalism1",
				"subst:uw-vandalism2",
				"subst:uw-vandalism3",
				"subst:uw-vandalism4",
				"subst:uw-vandalism4im"
			],
			label: "vandalism",
			desc: "Default warning for vandalism."
		},
		"Disruption": {
			templates: [
				"subst:uw-disruptive1",
				"subst:uw-disruptive2",
				"subst:uw-disruptive3",
				"subst:uw-generic4"
			],
			label: "disruptive editing",
			desc: "Default warning for making disruptive edits (not always vandalism)"
		},
		"Deleting": {
			templates: [
				"subst:uw-delete1",
				"subst:uw-delete2",
				"subst:uw-delete3",
				"subst:uw-delete4",
				"subst:uw-delete4im"
			],
			label: "unexplained deletion",
			desc: "Used when a user does not explain deletion of part of an article."
		},
		"Advertising": {
			templates: [
				"subst:uw-advert1",
				"subst:uw-advert2",
				"subst:uw-advert3",
				"subst:uw-advert4",
				"subst:uw-advert4im"
			],
			label: "advertising or promotion",
			desc: "Adding promotional content to an article."
		},
		"Spam links": {
			templates: [
				"subst:uw-spam1",
				"subst:uw-spam2",
				"subst:uw-spam3",
				"subst:uw-spam4",
				"subst:uw-spam4im"
			],
			label: "adding inappropriate links",
			desc: "Adding external links that could be considered spam."
		},
		"Unsourced": {
			templates: [
				"subst:uw-unsourced1",
				"subst:uw-unsourced2",
				"subst:uw-unsourced3",
				"subst:uw-unsourced4"
			],
			label: "adding unsourced content",
			desc: "Adding unsourced, possibly defamatory, content to an article."
		},
		"Editing tests": {
			templates: [
				"subst:uw-test1",
				"subst:uw-test2",
				"subst:uw-test3",
				"subst:uw-vandalism4"
			],
			label: "making editing tests",
			desc: "Making editing tests to articles."
		},
		"Commentary": {
			templates: [
				"subst:uw-talkinarticle1",
				"subst:uw-talkinarticle2",
				"subst:uw-talkinarticle3",
				"subst:uw-generic4"
			],
			label: "adding commentary",
			desc: "Adding opinion or commentary to articles."
		},
		"POV": {
			templates: [
				"subst:uw-npov1",
				"subst:uw-npov2",
				"subst:uw-npov3",
				"subst:uw-npov4"
			],
			label: "adding non-neutral content",
			desc: "Adding content which violates the neutral point of view policy."
		},
		"Errors": {
			templates: [
				"subst:uw-error1",
				"subst:uw-error2",
				"subst:uw-error3",
				"subst:uw-error4"
			],
			label: "adding deliberate errors to articles",
			desc: "Adding deliberate errors to articles."
		},
		"Owning": {
			templates: [
				"subst:uw-own1",
				"subst:uw-own2",
				"subst:uw-own3",
				"subst:uw-own4"
			],
			label: "assuming ownership of articles",
			desc: "Assuming ownership of articles."
		},
		"Unsourced (BLP)": {
			templates: [
				"subst:uw-biog1",
				"subst:uw-biog2",
				"subst:uw-biog3",
				"subst:uw-biog4",
				"subst:uw-biog4im"
			],
			label: "adding unsourced content to biographies of living persons",
			desc: "Adding unsourced content to biographies of living persons."
		},
		"Chatting": {
			templates: [
				"subst:uw-chat1",
				"subst:uw-chat2",
				"subst:uw-chat3",
				"subst:uw-chat4"
			],
			label: "conversation in article talk space",
			desc: "Using article talk pages for inappropriate discussion."
		},
		"Image vandalism": {
			templates: [
				"subst:uw-image1",
				"subst:uw-image2",
				"subst:uw-image3",
				"subst:uw-image4"
			],
			label: "image vandalism",
			desc: "Image vandalism."
		},
		"AfD removal": {
			templates: [
				"subst:uw-afd1",
				"subst:uw-afd2",
				"subst:uw-afd3",
				"subst:uw-afd4"
			],
			label: "removing AfD templates or other users' comments from AfD discussions",
			desc: "Removing AfD templates or other users' comments from AfD discussions."
		},
		"Jokes": {
			templates: [
				"subst:uw-joke1",
				"subst:uw-joke2",
				"subst:uw-joke3",
				"subst:uw-joke4",
				"subst:uw-joke4im"
			],
			label: "adding inappropriate humor",
			desc: "Adding inappropriate humor to articles."
		},
		"Personal attacks": {
			templates: [
				"subst:uw-npa1",
				"subst:uw-npa2",
				"subst:uw-npa3",
				"subst:uw-npa4",
				"subst:uw-npa4im"
			],
			label: "personal attacks",
			desc: "Personal attacks towards another user."
		},
		"MOS violation": {
			templates: [
				"subst:uw-mos1",
				"subst:uw-mos2",
				"subst:uw-mos3",
				"subst:uw-mos4"
			],
			label: "manual of style violation",
			desc: "Not following the Manual of Style."
		},
		"Censoring": {
			templates: [
				"subst:uw-notcensored1",
				"subst:uw-notcensored2",
				"subst:uw-notcensored3",
				"subst-uw-generic4"
			],
			label: "Censoring content",
			desc: "Censoring topically-relevant content."
		}
	},
	namespaces: [
		{ name: "Main", id: 0, category: "main" },
		{ name: "User", id: 2, category: "user" },
		{ name: "Project", id: 4, category: "wikipedia" },
		{ name: "File", id: 6, category: "other" },
		{ name: "MediaWiki", id: 8, category: "other" },
		{ name: "Template", id: 10, category: "other" },
		{ name: "Help", id: 12, category: "other" },
		{ name: "Category", id: 14, category: "other" },
		{ name: "Portal", id: 100, category: "other" },
		{ name: "Draft", id: 118, category: "draft" },
		{ name: "Talk", id: 1, category: "main" },
		{ name: "User talk", id: 3, category: "user" },
		{ name: "Project talk", id: 5, category: "wikipedia" },
		{ name: "File talk", id: 7, category: "other" },
		{ name: "MediaWiki talk", id: 9, category: "other" },
		{ name: "Template talk", id: 11, category: "other" },
		{ name: "Help talk", id: 13, category: "other" },
		{ name: "Category talk", id: 15, category: "other" },
		{ name: "Portal talk", id: 101, category: "other" },
		{ name: "Draft talk", id: 119, category: "draft" }
	],
	initialStyle: `
		<style>
			a {
				color: black;
			}

			body, html {
				display: flex;
				align-items: center;
				justify-content: center;
				height: 80%;
				font-family: Arial, Helvetica, sans-serif;
			}

			.start {
				text-align: center;
				background: blue;
				cursor: pointer;
				padding: 15px;
				color: white;
				border: none;
			}

			.start[disabled] {
				background: grey;
				cursor: not-allowed;
			}
		</style>
	`,
	initialContent: `
		<div class="container" style="text-align: center">
			<h1 style="margin-bottom: 5px">AntiVandal</h1>
			<p style="margin-top: 0">Created by <a target="_blank" href="https://en.wikipedia.org/wiki/User:Ingenuity">Ingenuity</a></p>
			<div style="text-align: left">
				<p>AntiVandal requires one of the following to run:</p>
				<ul>
					<li class="rights"><a target="_blank" href="/wiki/WP:ROLLBACK">Rollback</a> or <a target="_blank" href="/wiki/WP:ADMIN">sysop</a> user rights</li>
					<li class="whitelist">Inclusion on the AntiVandal whitelist</li>
				</ul>
			</div>
			<button class="start" disabled onclick="antiVandal.start()">Start AntiVandal</button>
		</div>
	`,
	style: `
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.1.1/css/all.min.css">
		<title>AntiVandal</title>
		<style>
			/* general */

			body, html {
				width: 100%;
				height: 100%;
				font-family: Arial, Helvetica, sans-serif;
				overflow-x: hidden;
				margin: 0;
			}

			* {
				box-sizing: border-box;
			}

			.unbold {
				font-weight: initial;
			}

			.sectionHeading {
				margin: 0;
				display: inline-block;
				font-size: 1em;
			}

			.centered {
				text-align: center;
			}

			/* login form */

			.loginFormContainer {
				display: flex;
				flex-direction: column;
				justify-content: center;
				padding: 30px;
				width: 50%;
				min-width: 400px;
				height: 100%;
				margin: auto;
			}

			.loginFormInput:not([type=checkbox]) {
				display: block;
			}

			.loginFormInput:not([type=checkbox]) {
				margin-bottom: 10px;
				padding: 5px;
				border: 1px solid #ccc;
			}

			.loginFormButton {
				display: block;
				width: 100%;
				height: 30px;
				text-align: center;
				margin-top: 10px;
			}

			.loginFormCheckboxContainer {
				margin-bottom: 10px;
			}

			.loginFormLabel {
				font-size: 0.9em;
			}

			.loginError {
				color: red;
				font-size: 0.9em;
			}

			/* main */

			.queueContainer, .infoContainer {
				width: 25%;
				max-width: 300px;
				height: 100%;
			}

			.queueContainer {
				overflow-y: scroll;
				overflow-x: hidden;
			}

			.diffContainer {
				width: 50%;
				border-left: 1px solid #ccc;
				border-right: 1px solid #ccc;
				flex-grow: 2;
			}

			.mainContainer {
				display: flex;
			}

			.mainFullHeight {
				height: 100%;
			}

			/* queue */

			.newPageWarning {
				background: yellow;
				position: absolute;
				top: 10px;
				left: 10px;
				padding: 5px;
				border-radius: 5px;
			}

			.queueItem, .abuseFilterDisallow {
				padding: 10px;
				border-bottom: 1px solid #ccc;
				position: relative;
			}

			.abuseFilterDisallow {
				padding: 10px 10px 10px 5px;
				border-left: 5px solid red;
			}

			.queueItemTitle, .queueItemUser, .infoItemTitle {
				text-decoration: none;
				color: black;
				font-size: 0.9em;
				text-overflow: clip;
				white-space: nowrap;
				overflow: hidden;
				width: fit-content;
				display: block;
			}

			.queueItemTitle span, .queueItemUser span {
				margin-right: 10px;
			}

			.queueItemUser, .infoItemTitle {
				margin-top: 5px;
				font-size: 0.8em;
			}

			.queueItemChange {
				width: 75px;
				height: 100%;
				position: absolute;
				top: 0;
				left: calc(100% - 75px);
				font-size: 0.9em;
				display: flex;
				align-items: center;
				justify-content: right;
				padding-right: 10px;
				background: linear-gradient(to right, rgba(255, 255, 255, 0), rgba(255, 255, 255, 1));
			}

			.queueItemChangeText {
				position: relative;
				z-index: 3;
			}

			.queueItemTag {
				border-radius: 3px;
				background: #ddd;
				padding: 2px 4px;
				margin: 3px;
				font-size: 0.7em;
				position: relative;
				z-index: 2;
			}

			.queueItemTags {
				white-space: nowrap;
			}

			.queueControls, .diffToolbar {
				padding: 10px;
				font-size: 1em;
				font-weight: bold;
				height: 50px;
				position: sticky;
				background: white;
				z-index: 4;
				border-bottom: 1px solid #ccc;
				top: 0;
			}

			.queueControls .sectionHeading {
				margin-top: 5px;
			}

			.queueControl {
				float: right;
				padding: 5px;
				font-size: 1.2em;
				cursor: pointer;
			}

			.currentQueueItem {
				background: #eee;
			}

			.queueStatusContainer {
				top: calc(100% - 60px);
				z-index: 5;
				position: fixed;
				font-size: 0.8em;
				width: 25%;
				max-width: 300px;
				text-align: center;
			}

			.queueStatus {
				background: #888;
				color: white;
				border-radius: 7px;
				padding: 8px;
				width: fit-content;
				margin: auto;
			}

			/* diff viewer */

			.diffContainer {
				overflow-y: auto;
			}

			.diffContainer td, .diffContainer tr {
				overflow-wrap: anywhere;
			}

			.diff-addedline {
				background: rgba(0, 255, 0, 0.3);
			}

			ins {
				background: rgba(0, 255, 0, 0.5);
				text-decoration: none;
			}

			.diff-deletedline {
				background: rgba(255, 0, 0, 0.3);
			}

			del {
				background: rgba(255, 0, 0, 0.5);
				text-decoration: none;
			}

			.diff-lineno {
				border-bottom: 1px dashed grey;
				background: rgba(0, 0, 0, 0.2);
			}

			.diffChangeContainer table, .diffChangeContainer tbody {
				font-family: monospace;
				vertical-align: baseline;
			}

			.diffToolbar {
				display: flex;
				align-items: center;
				justify-content: center;
				flex-wrap: wrap;
				position: fixed;
				width: calc(100% - 300px);
			}

			.diffToolbarItem {
				color: black;
				text-decoration: none;
				margin: 0 10px;
			}

			.diffToolbarItem a {
				color: black;
				text-decoration: none;
			}

			.diffChangeContainer td:not(.diff-marker) {
				width: 50%;
			}

			.diffToolbarOverlay {
				flex-basis: 100%;
				display: flex;
				justify-content: center;
				font-weight: normal;
				padding: 0 20px;
				white-space: nowrap;
				overflow: hidden;
			}

			.diffChangeContainer {
				margin-top: 50px;
				position: relative;
			}

			.diffActionContainer {
				position: fixed;
				height: 40px;
				top: calc(100% - 40px);
				background: white;
				display: flex;
				align-items: center;
				border-top: 1px solid #ccc;
				width: calc(100% - 602px);
			}

			.diffActionItem {
				height: 100%;
				width: fit-content;
				cursor: pointer;
				user-select: none;
				padding: 0 15px;
				display: flex;
				align-items: center;
				text-align: center;
				position: relative;
				z-index: 5;
			}

			.diffActionBox {
				position: absolute;
				left: 0;
				top: -410px;
				height: 410px;
				width: 390px;
				border: 1px solid #ccc;
				cursor: initial;
				user-select: initial;
				text-align: left;
				display: none;
				padding: 15px;
				background: white;
				overflow-y: scroll;
				overflow-x: hidden;
			}

			.diffActionItem:hover {
				background: #eee;
			}

			.diffWarning {
				padding: 5px;
				border-radius: 3px;
				width: 35px;
				display: inline-block;
				font-size: 0.8em;
				user-select: none;
				cursor: pointer;
				text-align: center;
			}

			.diffWarningLabel {
				font-size: 0.9em;
				white-space: nowrap;
			}

			.diffProgressContainer {
				position: fixed;
				top: calc(100% - 80px);
				height: 40px;
				display: flex;
				justify-content: flex-end;
				align-items: center;
				width: calc(100% - 600px);
				padding: 0px 20px;
			}

			.diffProgressBar {
				border-radius: 5px;
				width: 150px;
				height: 25px;
				background: #ddd;
				font-size: 0.8em;
				display: flex;
				align-items: center;
				justify-content: center;
				position: relative;
				margin-left: 10px;
				opacity: 1;
				transition: 0.3s;
			}

			.diffProgressBarOverlay {
				position: absolute;
				top: 0;
				left: 0;
				border-radius: 5px;
				width: 0px;
				transition: 0.3s;
				height: 100%;
				background: rgb(0, 170, 255);
			}

			#aivReportIcon, #uaaReportIcon {
				margin-left: 10px;
			}

			.diffActionBox a {
				color: black;
			}

			.diffProgressBarText {
				position: relative;
			}

			.diffWarningsContainer td {
				padding: 2px;
			}

			.warningLevel1 {
				background: rgb(138, 203, 223);
			}

			.warningLevel2 {
				background: rgb(215, 223, 138);
			}

			.warningLevel3 {
				background: rgb(226, 170, 97);
			}

			.warningLevel4 {
				background: rgb(224, 82, 64);
			}

			.warningLevel5 {
				color: white;
				background: rgb(0, 0, 0);
			}

			/* info container */

			.infoContainer {
				margin-top: 50px;
				height: calc(100% - 50px);
			}

			.infoContainerItem {
				height: 50%;
				overflow-y: scroll;
				overflow-x: hidden;
				border-bottom: 1px solid #ccc;
			}

			.infoItemTitle {
				margin-bottom: 3px;
			}

			.infoItemTitle .fas {
				width: 20px;
			}

			.infoItemTime {
				font-size: 0.8em;
			}

			.infoContainerItemHeading {
				padding: 10px;
				border-bottom: 1px solid #ccc;
			}

			.infoEditCount, .infoWarnLevel {
				font-size: 0.8em;
			}

			.infoEditCount {
				margin-right: 10px;
			}

			/* settings */

			.settings, .changelog {
				display: none;
				align-items: center;
				justify-content: center;
				position: fixed;
				width: 100%;
				height: 100%;
				top: 0;
				left: 0;
				z-index: 10;
			}
			
			.changelog {
				display: flex;
			}

			.changelogContainer {
				display: block !important;
				padding: 20px;
			}

			.settingsContainer, .changelogContainer {
				width: 60%;
				min-width: 800px;
				height: 60%;
				min-height: 600px;
				background: white;
				border: 1px solid #bbb;
				position: relative;
				display: flex;
				flex-wrap: wrap;
			}

			.settings input {
				position: relative;
				z-index: 10;
			}

			.settingsSectionContainer {
				width: 150px;
				border-right: 1px solid #ccc;
				height: 100%;
			}

			.settingsSection {
				border-bottom: 1px solid #ccc;
				padding: 10px;
				user-select: none;
				cursor: pointer;
			}

			.settingsSectionSelected {
				background: #ddd;
			}

			.settingsButton {
				width: 100px;
				height: 30px;
			}

			.settingsButtonContainer, .settingsCloseContainer {
				text-align: right;
				position: absolute;
				top: calc(100% - 40px);
				width: calc(100% - 10px);
				left: 0;
				user-select: none;
				flex-basis: 100%;
			}

			.settingsCloseContainer {
				top: 10px;
			}

			.settingsClose {
				cursor: pointer;
				font-size: 1.5em;
			}

			.selectedSettings {
				padding: 15px;
				max-width: calc(100% - 150px);
			}

			.message {
				position: absolute;
				text-align: right;
				left: 0;
				width: calc(100% - 20px);
			}

			#reportIcon {
				margin-left: 10px;
			}

			#user-being-reported, #report-notice {
				font-size: 0.8em;
			}

			.ores {
				height: 5px;
				background: #ddd;
				position: absolute;
				top: calc(100% - 5px);
				left: 0;
				width: 100%;
			}

			.ores-red {
				background: red;
			}

			.ores-orange {
				background: orange;
			}

			.ores-yellow {
				background: yellow;
			}

			label[for=minORES] {
				display: block;
			}

			#queueItems {
				font-weight: normal;
			}

			#revert-summary {
				width: 100%;
				height: 2em;
				padding: 5px;
				margin: 10px 0;
			}

			@media screen and (max-width: 1200px) {
				.diffActionContainer {
					width: calc(50% - 2px);
				}

				.diffToolbar {
					width: calc(75%);
				}
			}
		</style>
	`,
	content: `
		<div class="mainContainer mainFullHeight">
			<div class="queueContainer mainFullHeight">
				<div class="queueControls">
					<h2 class="sectionHeading">Queue <span id="queueItems">(0 items)</span></h2>
					<span class="fas fa-gear queueControl" id="settings" title="Settings"></span>
					<span class="fas fa-trash-can queueControl" id="queueDelete" title="Remove all items from queue"></span>
					<span class="fas fa-arrow-right queueControl" id="queueForward" title="Go to next edit"></span>
					<span class="fas fa-arrow-left queueControl" id="queueBack" title="Go to previous edit"></span>
				</div>
				<div class="queueItemsContainer"></div>
				<div class="queueStatusContainer">
					<div class="queueStatus">Loading queue...</div>
				</div>
			</div>
			<div class="diffContainer mainFullHeight">
				<div class="diffToolbar"></div>
				<div class="diffChangeContainer"></div>
				<div class="diffActionContainer">
					<div class="diffActionItem">
						Warn
						<div class="diffActionBox">
							<span>Warn and revert</span>
							<table class="diffWarningsContainer"></table>
						</div>
					</div>
					<div class="diffActionItem" id="report-menu">
						AIV
						<span id="aivReportIcon" class="fa fa-circle-exclamation" style="display: none;"></span>
						<div class="diffActionBox">
							<span>Report user to 
								<a target="_blank" title="Administrator intervention against vandalism" href="https://en.wikipedia.org/wiki/WP:AIV">AIV</a>
							</span><br>
							<input type="radio" id="past-final-warning" name="report-reason" checked>
							<label for="past-final-warning">Vandalism past final warning</label><br>
							<input type="radio" id="vandalism-only-acc" name="report-reason">
							<label for="vandalism-only-acc">Vandalism only account</label><br>
							<input type="radio" id="other-reason" name="report-reason">
							<label for="other-reason">Other (specify)</label><br>
							<input for="other-reason" id="report-reason" type="text"><br>
							<button class="aiv-button" disabled>Report</button><br><br>
						</div>
					</div>
					<div class="diffActionItem" id="uaa-menu">
						UAA
						<span id="uaaReportIcon" class="fa fa-circle-exclamation" style="display: none;"></span>
						<div class="diffActionBox">
							<span>Report user to
								<a target="_blank" title="Usernames for administrator attention" href="https://en.wikipedia.org/wiki/WP:UAA">UAA</a>
							</span><br>
							<input type="radio" id="uaa-misleading" name="uaa-reason" checked>
							<label for="uaa-misleading">Misleading username</label><br>
							<input type="radio" id="uaa-promotional" name="uaa-reason">
							<label for="uaa-promotional">Promotional username</label><br>
							<input type="radio" id="uaa-disruptive" name="uaa-reason">
							<label for="uaa-disruptive">Disruptive username</label><br>
							<input type="radio" id="uaa-offensive" name="uaa-reason">
							<label for="uaa-offensive">Offensive username</label><br>
							<input type="radio" id="uaa-other" name="uaa-reason">
							<label for="uaa-other">Other (specify)</label><br>
							<input for="uaa-other" id="uaa-reason" type="text"><br>
							<button class="uaa-button" disabled>Report</button><br><br>
						</div>
					</div>
					<div class="diffActionItem">
						Revert with summary
						<div class="diffActionBox">
							<span>Revert with summary</span><br>
							<input type="text" id="revert-summary" placeholder="Revert summary"><br>
							<button id="revert-button">Revert</button>
						</div>
					</div>
					<!-- <div class="diffActionItem">
						Block
					</div> -->
					<div class="message"></div>
				</div>
				<div class="diffProgressContainer"></div>
			</div>
			<div class="infoContainer mainFullHeight">
				<div class="infoContainerItem">
					<div class="infoContainerItemHeading">
						<h2 class="sectionHeading">User contributions</h2><br>
						<span class="infoEditCount">Count: ___</span>
						<span class="infoWarnLevel">Warn level: _</span>
					</div>
					<div class="userContribs"></div>
				</div>
				<div class="infoContainerItem">
					<div class="infoContainerItemHeading">
						<h2 class="sectionHeading">Page history</h2>
					</div>
					<div class="pageHistory"></div>
				</div>
			</div>
		</div>
		<div class="settings">
			<div class="settingsContainer">
				<div class="settingsSectionContainer">
					<div class="settingsSection settingsSectionSelected">Queue</div>
					<!--<div class="settingsSection">Controls</div>
					<div class="settingsSection">Interface</div>-->
				</div>
				<div class="settingsButtonContainer">
					<button class="settingsButton settingsCancel" onclick="antiVandal.interface.hideSettings()">Cancel</button>
					<button class="settingsButton settingsSave" onclick="antiVandal.interface.saveSettings()">Save</button>
				</div>
				<div class="settingsCloseContainer">
					<span class="fas fa-xmark settingsClose" title="Close settings" onclick="antiVandal.interface.hideSettings()"></span>
				</div>
				<div class="selectedSettings">
					<div class="queueSettings">
						<span>Show edits from users with fewer than</span>
						<input type="number" name="queueUsersCount">
						<label for="queueUsersCount">edits</label><br><br>
						<label for="queueMaxSize">Maximum queue size:</label>
						<input type="number" name="queueMaxSize"><br><br>
						<span>Show edits from these namespaces:</span><br>
						<input type="checkbox" name="namespaceMain">
						<label for="namespaceMain">Main and Talk:</label><br>
						<input type="checkbox" name="namespaceUser">
						<label for="namespaceUser">User: and User talk:</label><br>
						<input type="checkbox" name="namespaceDraft">
						<label for="namespaceDraft">Draft: and Draft talk:</label><br>
						<input type="checkbox" name="namespaceWikipedia">
						<label for="namespaceWikipedia">Wikipedia: and Wikipedia talk:</label><br>
						<input type="checkbox" name="namespaceOther">
						<label for="namespaceOther">All other namespaces</label><br><br>
						<span>Ignore edits with an ORES score of less than:</span><br>
						<label for="minORES">0</label>
						<input type="range" name="minORES" min=0 max=1 step=0.05>
						<p>ORES is an estimate of how likely an edit is to be vandalism; the higher the score, the higher the chance the edit is harmful. However, setting the minimum ORES score to a higher value will show fewer edits.</p>
						<span id="statistics">Total of x reviewed and x reverted edits (x% revert rate), plus x reports.</span><br>
						<p>These statistics may not be accurate if you use AntiVandal on more than one device, since they are stored locally.</p>
					</div>
				</div>
			</div>
		</div>
	`
};

let antiVandal;

if (mw.config.get("wgRelevantPageName") === "Wikipedia:AntiVandal/run" && mw.config.get("wgAction") === "view") {
	antiVandal = new AntiVandal();
	antiVandal.startInterface();
	
	window.addEventListener("keydown", antiVandal.keyPressed.bind(antiVandal));
} else {
	mw.util.addPortletLink(
		'p-personal',
		mw.util.getUrl('Wikipedia:AntiVandal/run'),
		'AntiVandal',
		'pt-AntiVandal',
		'AntiVandal',
		null,
		'#pt-preferences'
	);
}

// </nowiki>
