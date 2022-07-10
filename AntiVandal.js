/* <nowiki> */

let antiVandalOptions = {
	// maximum number of items in the queue
	maxQueueSize: 50,
	// which wiki is being used (eg "en" on en.wikipedia)
	wiki: mw.config.values.wgServerName.split(".")[0],
	// hotkeys
	controls: {
		markAsVandalism: "q",
		continueToNext: " ",
		queueBack: "[",
		queueForward: "]"
	},
	// how often to load recent changes
	refreshTime: 5000,
	// ignore users with over this number of edits
	maxEditCount: 50
};

// list of common warnings
const warnings = {
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
	}
};

let currentId = null, currentEdit = null, rcstart = null, messageTimeout = null;
let lastRevId = 0;
let queueItems = [], pastQueueItems = [];
const antiVandalApi = new mw.Api();

let currentAIVReports = [];
let reportNum = 0;

// shorthand for querySelector
const qs = document.querySelector.bind(document);

async function runAntiVandal() {
	// if the url isn't the run location, add a link to the page instead
	if (!location.href.includes("User:Ingenuity/AntiVandal/run")) {
		addAntiVandalLink();
		return;
	}

	const username = mw.config.values.wgUserName;
	const registeredDate = new Date(mw.config.values.wgUserRegistration);
	const editCount = mw.config.values.wgUserEditCount;
	const userGroups = mw.config.values.wgUserGroups;

	let allowed = false;

	document.head.innerHTML = `
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
		<title>AntiVandal</title>
	`;

	document.body.innerHTML = `
		<div class="container" style="text-align: center">
			<h1 style="margin-bottom: 5px">AntiVandal</h1>
			<p style="margin-top: 0">Created by <a target="_blank" href="https://en.wikipedia.org/wiki/User:Ingenuity">Ingenuity</a></p>
			<div style="text-align: left">
				<p>AntiVandal requires one of the following to run:</p>
				<ul>
					<li class="edits">250 edits and 7 days since registration</li>
					<li class="rights"><a target="_blank" href="/wiki/WP:ROLLBACK">Rollback</a> or <a target="_blank" href="/wiki/WP:ADMIN">sysop</a> user rights</li>
					<li class="whitelist">Inclusion on the AntiVandal whitelist</li>
				</ul>
			</div>
			<button class="start" disabled onclick="startInterface()">Start AntiVandal</button>
		</div>
	`;

	if (editCount < 250 || (new Date() - registeredDate) / 1000 / 60 / 60 / 24 < 7) {
		qs(".edits").style.color = "red";
	} else {
		qs(".edits").style.color = "green";
		allowed = true;
	}

	if (userGroups.includes("rollbacker") || userGroups.includes("sysop")) {
		qs(".rights").style.color = "green";
		allowed = true;
	} else {
		qs(".rights").style.color = "red";
	}

	let users = [];

	try {
		const options = {
			action: "query",
			format: "json",
			prop: "revisions",
			titles: "User:Ingenuity/AntiVandalWhitelist.json",
			formatversion: 2,
			rvprop: "content",
			rvslots: "*"
		};
		const content = (await antiVandalApi.get(options)).query.pages[0].revisions[0].slots.main.content;

		users = JSON.parse(content).users;
	} catch (err) {}

	if (users.includes(username)) {
		qs(".whitelist").style.color = "green";
		allowed = true;
	} else {
		qs(".whitelist").style.color = "red";
	}

	qs(".start").disabled = !allowed;
}

function startInterface() {
	createInterface();

	// add listener for hotkey presses
	window.addEventListener("keyup", (event) => {
		if (document.activeElement.nodeName.toLowerCase() === "input") {
			return;
		}

		if (event.key.toLowerCase() === antiVandalOptions.controls.queueBack) {
			if (pastQueueItems.length === 0) {
				return;
			}
			queueItems.unshift(pastQueueItems.pop());
			renderQueue();
			return;
		}

		if (event.key.toLowerCase() === antiVandalOptions.controls.queueForward) {
			shiftQueue();
			return;
		}

		if (event.key.toLowerCase() === antiVandalOptions.controls.continueToNext) {
			shiftQueue();
			return;
		}

		if (event.key.toLowerCase() === antiVandalOptions.controls.markAsVandalism) {
			revert({ id: currentId, template: "auto" });
			shiftQueue();
			return;
		}
	});

	// prevent spacebar from scrolling page
	window.addEventListener("keydown", (event) => {
		if (event.key === " " && event.target === document.body) {
			event.preventDefault();
		}
	});

	qs("#queueDelete").onclick = () => {
		queueItems = [];
		renderQueue();
	}

	qs("#queueBack").onclick = () => {
		if (pastQueueItems.length === 0) {
			return;
		}
		queueItems.unshift(pastQueueItems.pop());
		renderQueue();
	}

	qs("#queueForward").onclick = () => {
		shiftQueue();
		return;
	}

	qs(".settingsClose").onclick = hideSettings;
	qs(".settingsCancel").onclick = hideSettings;

	qs(".settingsSave").onclick = saveSettings;
	// qs("#settings").onclick = showSettings;

	const diffToolbarItems = Array.prototype.slice.call(document.querySelectorAll(".diffActionItem"));

	const warningsContainer = qs(".diffWarningsContainer");

	[...document.querySelectorAll(".diffActionBox")].forEach(e => {
		e.onclick = (event) => event.stopPropagation()
	});

	qs("#report-reason").onfocus = () => qs("#other-reason").checked = true;
	qs(".report-button").onclick = reportCurrentUser;

	qs("#revert-button").onclick = () => {
		const summary = qs("#revert-summary").value;
		revert({ id: currentId, summary: summary }, true);
		shiftQueue();

		for (let e of [...document.querySelectorAll(".diffActionBox")]) {
			e.style.display = "none";
		}

		for (let e of [...document.querySelectorAll(".diffActionItem")]) {
			e.style.background = "";
		}
	}

	for (let item in warnings) {
		const templates = document.createElement("tr");
		let html = `<td><span class="diffWarningLabel">${item}</span></td>`;
		for (let i = 0; i < warnings[item].templates.length; i++) {
			html += `<td><span
				class="diffWarning warningLevel${i + 1}"
				title="${warnings[item].templates[i]}"
				onclick="revertButton('${item}', ${i})">${i === 4 ? "4im" : i + 1}</span></td>`;
		}
		if (warnings[item].templates.length === 4) {
			html += "<td></td>";
		}
		templates.innerHTML = html + "<td><span class='fas fa-circle-question reason-explanation' title='" + warnings[item].desc + "'></span></td>";
		warningsContainer.appendChild(templates);
	}

	for (let item of diffToolbarItems) {
		item.onclick = function() {
			if (this.id === "report-menu") {
				qs("#report-reason").value = "";
				qs("#past-final-warning").checked = true;
			}
			const elem = this.querySelector(".diffActionBox");
			if (elem.style.display !== "initial") {
				for (let e of [...document.querySelectorAll(".diffActionBox")]) {
					e.style.display = "none";
				}
				for (let e of [...document.querySelectorAll(".diffActionItem")]) {
					e.style.background = "";
				}
				elem.style.display = "initial";
				this.style.background = "#ddd";
			} else {
				elem.style.display = "none";
				this.style.background = "";
			}
		}
	}

	fetchRecentChanges();
	updateAIVReports();
	window.setInterval(updateAIVReports, 15000);
}

// fetch recent changes from API
async function fetchRecentChanges() {
	let greatestRevId = 0;

	try {
		if (queueItems.length >= antiVandalOptions.maxQueueSize) {
			renderQueue();
			window.setTimeout(() => fetchRecentChanges(), antiVandalOptions.refreshTime);
			return;
		}
	
		const options = {
			action: "query",
			format: "json",
			list: "recentchanges",
			rcprop: "title|ids|sizes|flags|user|tags|comment",
			rclimit: 50,
			rctype: "edit|new",
		};
	
		if (rcstart) {
			options.rcstart = rcstart;
			options.rcdir = "newer";
		}

		const date = new Date();

		rcstart = date.getUTCFullYear() + "-" +
			padString(date.getUTCMonth() + 1, 2) + "-" +
			padString(date.getUTCDate(), 2) + "T" +
			padString(date.getUTCHours(), 2) + ":" +
			padString(date.getUTCMinutes(), 2) + ":" +
			padString(date.getUTCSeconds(), 2);

		const data = await antiVandalApi.get(options);
	
		const changes = data.query.recentchanges;
		let usersToFetch = [];
	
		for (let change of changes) {
			if (lastRevId > change.revid) {
				continue;
			}
			if (!usersToFetch.includes(change.user)) {
				usersToFetch.push(change.user);
			}
			greatestRevId = Math.max(greatestRevId, change.revid);
		}
	
		const userData = (await antiVandalApi.get({
			action: "query",
			format: "json",
			list: "users",
			usprop: "editcount",
			ususers: usersToFetch.join("|")
		})).query.users;
	
		let talkPageData = (await antiVandalApi.get({
			action: "query",
			format: "json",
			prop: "revisions",
			titles: usersToFetch.map(u => "User_talk:" + u).join("|"),
			formatversion: 2,
			rvprop: "content",
			rvslots: "*"
		}));
	
		if (typeof talkPageData.query === "undefined") {
			return;
		}
	
		talkPageData = talkPageData.query.pages;
	
		const warnLevels = {};
	
		for (let item in talkPageData) {
			const username = talkPageData[item].title.split(":")[1];
			if (typeof talkPageData[item].missing !== "undefined") {
				warnLevels[username] = "0";
				continue;
			}

			warnLevels[username] = getWarningLevel(talkPageData[item].revisions[0].slots.main.content);
		}
	
		let editCounts = {};
	
		for (let user of userData) {
			if (typeof user.invalid === "string") {
				editCounts[user.name] = -1;
				continue;
			}
			editCounts[user.name] = user.editcount;
		}
	
		for (let change of changes) {
			if (editCounts[change.user] > antiVandalOptions.maxEditCount || !editCounts[change.user]) {
				continue;
			}
	
			addQueueItem(change, editCounts[change.user], warnLevels[change.user] || "0");
		}
	} catch (e) {
		console.log("Failed to fetch recent changes: " + e);
	}

	lastRevId = Math.max(lastRevId, greatestRevId);
	window.setTimeout(() => fetchRecentChanges(), antiVandalOptions.refreshTime);
}

// get diff, user contributions, and page history for each edit
async function addQueueItem(change, editcount, warnLevel) {
	try {
		const diff = await (antiVandalApi.get({
			action: "compare",
			format: "json",
			fromrev: change.old_revid,
			torev: change.revid,
			prop: "diff"
		}));

		const usercontribs = await (antiVandalApi.get({
			action: "query",
			format: "json",
			list: "usercontribs",
			uclimit: 10,
			ucuser: change.user,
			ucprop: "title|timestamp|comment|sizediff|tags|ids"
		}));

		const pageHistory = (await (antiVandalApi.get({
			action: "query",
			format: "json",
			prop: "revisions",
			titles: change.title,
			formatversion: 2,
			rvprop: "comment|user|timestamp|tags|ids",
			rvslots: "*",
			rvlimit: 10
		}))).query.pages[0].revisions;

		const item = {
			user: change.user,
			editcount: editcount,
			change: change.newlen - change.oldlen,
			title: change.title,
			pageLink: `https://en.wikipedia.org/wiki/${change.title}`,
			userLink: `https://en.wikipedia.org/wiki/Special:Contributions/${change.user}`,
			userTalkLink: `https://en.wikipedia.org/wiki/User_talk:${change.user}`,
			userPageLink: `https://en.wikipedia.org/wiki/User:${change.user}`,
			tags: change.tags,
			diff: diff.compare["*"],
			id: change.revid,
			comment: change.comment,
			usercontribs: usercontribs.query.usercontribs,
			wiki: "en",
			warnLevel: warnLevel,
			pageHistory: pageHistory
		};

		queueItems.push(item);
		renderQueue();
	} catch (err) {}
}

async function revert(data, toWarn) {
	qs(".diffProgressContainer").innerHTML += `
		<div class="diffProgressBar" id="revert-${data.id}">
			<div class="diffProgressBarOverlay"></div>
			<div class="diffProgressBarText">Getting history...</div>
		</div>
	`;

	const progressBarId = "#revert-" + data.id;
	const overlayId = "#revert-" + data.id + " > .diffProgressBarOverlay";
	const textId = "#revert-" + data.id + " > .diffProgressBarText";
	
	try {
		let revdata = (await antiVandalApi.get({
			action: "query",
			format: "json",
			prop: "revisions",
			revids: data.id,
			rvprop: "user|timestamp"
		})).query.pages;

		let pageId;

		for (let item in revdata) {
			pageId = item;
		}

		const revision = revdata[pageId].revisions[0];
		const title = revdata[pageId].title;

		const pageHistory = (await antiVandalApi.get({
			action: "query",
			format: "json",
			prop: "revisions",
			pageids: pageId,
			rvprop: "user|timestamp|ids",
			rvlimit: 10
		})).query.pages[pageId].revisions;

		if (pageHistory[0].timestamp !== revision.timestamp ||
			pageHistory[0].user !== revision.user) {
			qs(overlayId).style.background = "rgb(255, 60, 60)";
			qs(overlayId).style.width = "100%";
			qs(textId).innerText = "Edit conflict";
			hideProgressBar(progressBarId);
			return;
		}

		let content;

		for (let rev of pageHistory) {
			if (rev.user !== revision.user) {
				content = (await antiVandalApi.get({
					action: "query",
					format: "json",
					formatversion: 2,
					prop: "revisions",
					revids: rev.revid,
					rvprop: "content"
				})).query.pages[0].revisions[0].content;

				break;
			}
		}

		if (!content) {
			qs(overlayId).style.background = "rgb(255, 60, 60)";
			qs(overlayId).style.width = "100%";
			qs(textId).innerText = "Could not get page";
			hideProgressBar(progressBarId);
			return;
		}

		qs(overlayId).style.width = "25%";
		qs(textId).innerText = "Reverting...";

		const summary = `Reverted edits by [[Special:Contributions/${revision.user}|${revision.user}]] ([[User talk:${revision.user}|talk]])${data.summary ? ": " + data.summary : ""} ([[User:Ingenuity/AntiVandal|AV]])`;

		const response = await antiVandalApi.post({
			action: "edit",
			format: "json",
			pageid: pageId,
			baserevid: data.id,
			summary: summary,
			text: content,
			token: await getCSRFToken(),
			nocreate: 1
		});

		if (!toWarn) {
			if (response.error || response.edit.result !== "Success") {
				qs(overlayId).style.background = "rgb(255, 60, 60)";
				qs(overlayId).style.width = "100%";
				qs(textId).innerText = "Edit conflict";
				hideProgressBar(progressBarId);
				return;
			}

			qs(overlayId).style.width = "50%";
			qs(textId).innerText = "Getting talk...";

			const talkPage = (await antiVandalApi.get({
				action: "query",
				format: "json",
				formatversion: 2,
				prop: "revisions",
				rvprop: "content",
				titles: "User_talk:" + revision.user
			})).query.pages;

			qs(overlayId).style.width = "75%";
			qs(textId).innerText = "Warning...";

			let createNewSection = false, talkContent = "", newContent = "";

			if (typeof Object.values(talkPage)[0].missing !== "undefined") {
				createNewSection = true;
			} else {
				talkContent = Object.values(talkPage)[0].revisions[0].content;
				if (talkContent.match(new RegExp("== ?" + getMonthSectionName() + " ?==")) === null) {
					createNewSection = true;
				}
			}

			const warnLevel = getWarningLevel(talkContent);

			if (warnLevel === "4" || warnLevel === "4im") {
				newMessage("User is already at level 4 warning");
				qs(overlayId).style.width = "100%";
				qs(textId).innerText = "Done";
				hideProgressBar(progressBarId);
				return;
			}

			let warnTemplate;

			if (data.template === "auto") {
				warnTemplate = "{{subst:uw-vandalism" + (Number(warnLevel) + 1) + "|" + title + "}} ~~" + "~~";
			} else {
				warnTemplate = "{{" + data.template.wikitext + "|" + title + "}}" + " ~~" + "~~";
			}

			if (createNewSection) {
				newContent = talkContent + "\n== " + getMonthSectionName() + " ==\n\n" + warnTemplate;
			} else {
				const sections = talkContent.split(/(?=== ?[\w\d ]+ ?==)/g);

				for (let section in sections) {
					if (sections[section].match(new RegExp("== ?" + getMonthSectionName() + " ?==")) !== null) {
						sections[section] += "\n\n" + warnTemplate + "\n";
					}
				}

				newContent = sections.join("");
			}

			newContent = newContent.replaceAll("\n\n\n", "\n\n");

			await antiVandalApi.post({
				action: "edit",
				format: "json",
				title: "User_talk:" + revision.user,
				summary: `Message about your edit on [[${title}]] (level ${(data.template.level || Number(warnLevel)) + 1}) ([[User:Ingenuity/AntiVandal|AV]])`,
				text: newContent,
				token: await getCSRFToken()
			});
		}

		qs(overlayId).style.width = "100%";
		qs(textId).innerText = "Done";
		hideProgressBar(progressBarId);
	} catch (err) {
		qs(overlayId).style.background = "rgb(255, 60, 60)";
		qs(overlayId).style.width = "100%";
		qs(textId).innerText = "Edit conflict";
		hideProgressBar(progressBarId);
		console.log(err);
	}
}

// hide a progress bar after 3 secs
function hideProgressBar(id) {
	window.setTimeout(() => {
		qs(id).style.opacity = "0";
		window.setTimeout(() => {
			qs(id).remove();
		}, 400);
	}, 3000);
}

function revertButton(template, level) {
	revert({
		id: currentId,
		template: {
			label: warnings[template].label,
			wikitext: warnings[template].templates[level],
			level: level
		}
	});
	shiftQueue();

	for (let e of [...document.querySelectorAll(".diffActionBox")]) {
		e.style.display = "none";
	}

	for (let e of [...document.querySelectorAll(".diffActionItem")]) {
		e.style.background = "";
	}
}

// get CSRF token used for making edits
async function getCSRFToken() {
	return (await antiVandalApi.get({
		action: "query",
		meta: "tokens",
		format: "json"
	})).query.tokens.csrftoken;
}

// display message
function newMessage(message) {
	qs(".message").innerHTML = message;
	clearTimeout(messageTimeout);
	messageTimeout = setTimeout(() => qs(".message").innerHTML = "", 5000);
}

// find maximum warning level for user
function getWarningLevel(page) {
	const monthSections = page.split(/(?=== ?[\w\d ]+ ?==)/g);

	for (let section of monthSections) {
		if (new RegExp("== ?" + getMonthSectionName() + " ?==").test(section)) {
			const templates = section.match(/<\!-- Template:[\w-]+?(\di?m?) -->/g);
			if (templates === null) {
				return "0";
			}
			const filteredTemplates = templates.map(t => {
				const match = t.match(/<\!-- Template:[\w-]+?(\di?m?) -->/);
				if (!match) {
					return "0";
				}
				return match[1];
			});
			return filteredTemplates.sort()[filteredTemplates.length - 1].toString();
		}
	}

	return "0";
}

// returns current month and year (etc "April 2022")
function getMonthSectionName() {
	const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
	const currentMonth = months[new Date().getUTCMonth()];
	const currentYear = new Date().getUTCFullYear();

	return currentMonth + " " + currentYear;
}

// pad a string with 0's
function padString(str, len) {
	str = str.toString();
	while (str.length < len) {
		str = "0" + str;
	}
	return str;
}

// delete the first item from the queue
function shiftQueue() {
	pastQueueItems.push(queueItems.shift());
	if (pastQueueItems.length > 10) {
		pastQueueItems.shift();
	}
	renderQueue();
}

// renders items to queue
function renderQueue() {
	const queueContainer = qs(".queueItemsContainer");
	queueContainer.innerHTML = "";

	if (queueItems.length === 0) {
		displayDiff(null);
	}

	for (let i = 0; i < queueItems.length; i++) {
		if (i === 0 && queueItems[i].id !== currentId) {
			currentId = queueItems[i].id;
			currentEdit = queueItems[i];
			displayDiff(queueItems[i]);
		}
		renderQueueItem(queueItems[i], i !== 0);
	}

	let status;

	if (queueItems.length >= antiVandalOptions.maxQueueSize) {
		status = "Queue is paused";
	} else if (queueItems.length === 0) {
		status = "Loading more items...";
	}

	if (status) {
		qs(".queueStatusContainer").style.display = "initial";
		qs(".queueStatus").innerText = status;
	} else {
		qs(".queueStatusContainer").style.display = "none";
	}
}

// render an individual item to the queue section
function renderQueueItem(item, isSelected) {
	const queueContainer = qs(".queueItemsContainer");
	let tagHTML = "";

	if (item.tags.length > 2) {
		let extra = item.tags.length - 2;
		item.tags = item.tags.splice(0, 2);
		item.tags.push("+" + extra + " more");
	}

	for (let tag of item.tags) {
		tagHTML += `<span class="queueItemTag">${tag}</span>`;
	}

	queueContainer.innerHTML += `
		<div class="queueItem${isSelected ? "" : " currentQueueItem"}">
			<a class="queueItemTitle" href="${item.pageLink}" target="_blank" title="${item.title}">
				<span class="fas fa-file-lines"></span>${item.title}
			</a>
			<a class="queueItemUser" href="${item.userLink}" target="_blank" title="User:${item.user}">
				<span class="fas fa-user"></span>${maxStringLength(item.user, 25)}
			</a>
			<div class="queueItemChange" style="color: ${getChangeColor(item.change)};">
				<span class="queueItemChangeText">${getChangeString(item.change)}</span>
			</div>
			<div class="queueItemTags">
				${tagHTML}
			</div>
		</div>
	`;
}

// update the diff menu, user contributions, and page history sections
function displayDiff(item) {
	const diffContainer = qs(".diffChangeContainer");
	diffContainer.style.height = "auto";
	diffContainer.style.display = "block";
	const toolbar = qs(".diffToolbar");
	const userContribsContainer = qs(".userContribs");
	userContribsContainer.innerHTML = "";
	const pageHistoryContainer = qs(".pageHistory");
	pageHistoryContainer.innerHTML = "";
	const editCountContainer = qs(".infoEditCount");
	const warnLevelContainer = qs(".infoWarnLevel");

	if (item === null) {
		diffContainer.style.height = "calc(100% - 100px)";
		diffContainer.style.display = "flex";
		diffContainer.style.alignItems = "center";
		diffContainer.style.justifyContent = "center";
		diffContainer.innerHTML = `Loading more results...`;
		toolbar.innerHTML = `<i>No edit selected</i>`;
		warnLevelContainer.innerText = "Warn level: N/A";
		editCountContainer.style.display = "none";
		qs("#user-being-reported").innerHTML = "User being reported: none";
		qs(".report-button").disabled = true;
		return;
	}

	diffContainer.innerHTML = `<table>${item.diff}</table>`;

	const summary = item.comment.length > 0 ? `Summary: ${maxStringLength(item.comment, 50)}` : "";

	toolbar.innerHTML = `
		<a class="diffToolbarItem" href="${item.pageLink}" target="_blank">
			<span class="fas fa-file-lines"></span>
			${item.title}
		</a>
		<span class="diffToolbarItem">
			<span class="fas fa-user"></span>
			<a href="${item.userPageLink}" target="_blank">${item.user}</a>&nbsp;
			<span class="unbold">
				(<a href="${item.userTalkLink}" target="_blank">talk</a> &bull; <a href="${item.userLink}" target="_blank">contribs</a>)
			</span>
		</span>
		<span class="diffToolbarItem">
			<span class="fas fa-pencil"></span>
			<span style="color: ${getChangeColor(item.change)};">${getChangeString(item.change)}</span>
		</span>
		<div class="diffToolbarOverlay">
			<span title="${item.comment}">${summary}</span>
		</div>
	`;

	for (let con of item.usercontribs) {
		let tagHTML = "";
		if (con.tags.includes("mw-reverted")) {
			tagHTML = `<span class="queueItemTag">Reverted</span>`;
		}
		userContribsContainer.innerHTML += `
			<div class="queueItem${con.revid === item.id ? ' currentQueueItem':''}">
				<a class="infoItemTitle" href="${getPageLink(con.title, item.wiki)}" target="_blank" title="${con.title}">
					<span class="fas fa-file-lines"></span>${con.title}
				</a>
				<a class="infoItemTitle" title="${con.comment || "No edit summary"}">
					<span class="fas fa-comment-dots"></span>${con.comment || "<em>No edit summary</em>"}
				</a>
				<a class="infoItemTitle infoItemTime" title="${con.timestamp}">
					<span class="fas fa-clock"></span>${timeAgo(con.timestamp)}
				</a>
				<div class="queueItemChange" style="color: ${getChangeColor(con.sizediff)};">
					<span class="queueItemChangeText">${getChangeString(con.sizediff)}</span>
				</div>
				<div class="queueItemTags">
					${tagHTML}
				</div>
			</div>
		`;
	}

	for (let con of item.pageHistory) {
		let tagHTML = "";
		if (con.tags.includes("mw-reverted")) {
			tagHTML = `<span class="queueItemTag">Reverted</span>`;
		}
		pageHistoryContainer.innerHTML += `
			<div class="queueItem${con.revid === item.id ? ' currentQueueItem':''}">
				<a class="infoItemTitle" href="${getPageLink("Special:Contributions/" + con.user, item.wiki)}" target="_blank" title="${con.user}">
					<span class="fas fa-user"></span>${con.user}
				</a>
				<a class="infoItemTitle" title="${con.comment || "No edit summary"}">
					<span class="fas fa-comment-dots"></span>${con.comment || "<em>No edit summary</em>"}
				</a>
				<a class="infoItemTitle infoItemTime" title="${con.timestamp}">
					<span class="fas fa-clock"></span>${timeAgo(con.timestamp)}
				</a>
				<div class="queueItemTags">
					${tagHTML}
				</div>
			</div>
		`;
	}

	if (item.editcount !== -1) {
		editCountContainer.style.display = "initial";
		editCountContainer.innerText = "Count: " + item.editcount;
	} else {
		editCountContainer.style.display = "none";
	}

	warnLevelContainer.innerText = "Warn level: " + item.warnLevel;

	const warningsContainer = qs(".diffWarningsContainer");
	if (qs("#diffWarn")) {
		qs("#diffWarn").remove();
	}
	let html = "<tbody id='diffWarn'><tr><td></td>";
	const warnLevels = ["0", "1", "2", "3", "4", "4im"];
	for (let i = 1; i < 6; i++) {
		if (currentEdit.warnLevel === warnLevels[i - 1]) {
			html += `<td class='centered' title="User's current warning level"><span class='fas fa-caret-down'></span></td>`;
		} else {
			html += "<td></td>";
		}
	}
	warningsContainer.innerHTML = html + "</tr></tbody>" + warningsContainer.innerHTML;

	qs("#user-being-reported").innerHTML = `User being reported: <a target="_blank" href="${item.userPageLink}">${item.user}</a> (<a target="_blank" href="${item.userTalkLink}">talk</a> &bull; <a target="_blank" href="${item.userLink}">contribs</a>)`;
	
	if (item.warnLevel === "4" || item.warnLevel === "4im") {
		qs("#report-notice").innerText = "";
	} else {
		qs("#report-notice").innerText = "This user does not appear to have a final warning on their talk page. Are you sure you want to report?";
	}

	if (checkIfReported(item.user)) {
		qs("#report-notice").innerText = "This user has already been reported.";
		qs(".report-button").disabled = true;
	} else {
		qs(".report-button").disabled = false;
	}

	updateReportToolbar(item.user, item.warnLevel);
}

// update the icon on the toolbar
function updateReportToolbar(username, warnLevel) {
	const icon = qs("#reportIcon");
	icon.style.color = "black";
	icon.style.display = "initial";

	if (checkIfReported(username)) {
		icon.className = "fas fa-circle-info";
	} else if (warnLevel === "4" || warnLevel === "4im") {
		icon.className = "fas fa-circle-exclamation";
		icon.style.color = "red";
	} else {
		icon.style.display = "none";
	}
}

// add link to the top bar
function addAntiVandalLink() {
	mw.util.addPortletLink(
		'p-personal',
		mw.util.getUrl('User:Ingenuity/AntiVandal/run'),
		'AntiVandal',
		'pt-AntiVandal',
		'AntiVandal',
		null,
		'#pt-preferences'
	);
}

// load the css and html for the interface
function createInterface() {
	document.body.innerHTML = `
		<div class="mainContainer mainFullHeight">
			<div class="queueContainer mainFullHeight">
				<div class="queueControls">
					<h2 class="sectionHeading">Queue</h2>
					<!-- <span class="fas fa-gear queueControl" id="settings" title="Settings"></span> -->
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
						Report
						<span id="reportIcon"></span>
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
							<button class="report-button" disabled>Report</button><br><br>
							<i id="user-being-reported">User being reported: N/A</i><br><br>
							<i id="report-notice"></i>
						</div>
					</div>
					<div class="diffActionItem">
						Revert with summary
						<div class="diffActionBox">
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
					<div class="settingsSection">Controls</div>
					<div class="settingsSection">Interface</div>
				</div>
				<div class="settingsButtonContainer">
					<button class="settingsButton settingsCancel">Cancel</button>
					<button class="settingsButton settingsSave">Save</button>
				</div>
				<div class="settingsCloseContainer">
					<span class="fas fa-xmark settingsClose" title="Close settings"></span>
				</div>
				<div class="selectedSettings">
					<div class="queueSettings">
						<span>Show edits from:</span><br>
						<input type="checkbox" name="queueIPs">
						<label for="queueIPs">Anonymous users (IPs)</label><br>
						<input type="checkbox" name="queueUsers">
						<label for="queueUsers">Users with fewer than</label>
						<input type="number" name="queueUsersCount">
						<label for="queueUsersCount">edits</label><br><br>
						<label for="queueMaxSize">Maximum queue size:</label>
						<input type="number" name="queueMaxSize">
					</div>
				</div>
			</div>
		</div>
	`;

	document.head.innerHTML = `
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

			.queueItem {
				padding: 10px;
				border-bottom: 1px solid #ccc;
				position: relative;
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

			.queueItemUser {
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
			}

			.diffChangeContainer {
				margin-top: 50px;
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
				width: 350px;
				border: 1px solid #ccc;
				cursor: initial;
				user-select: initial;
				text-align: left;
				display: none;
				padding: 15px;
				background: white;
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

			.settings {
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

			.settingsContainer {
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

			@media screen and (max-width: 1200px) {
				.diffActionContainer {
					width: calc(50% - 2px);
				}

				.diffToolbar {
					width: calc(75%);
				}
			}
		</style>
	`;
}

// green for changes > 0, gray for = 0, red for < 0
function getChangeColor(change) {
	if (change < 0) {
		return "red";
	} else if (change > 0) {
		return "green";
	}

	return "black";
}

// + for > 0, - for < 0
function getChangeString(change) {
	if (change > 0) {
		change = "+" + change;
	} else {
		change = change.toString().replace("-", "&ndash;");
	}

	return change;
}

// changes timestamp into x seconds/minutes/hours ago
function timeAgo(timestamp) {
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

// get url to page
function getPageLink(title) {
	return "https://" + antiVandalOptions.wiki + ".wikipedia.org/wiki/" + title;
}

// chop off strings over maximum length
function maxStringLength(str, len) {
	if (str.length > len) {
		str = str.substring(0, len) + "...";
	}
	return str;
}

// show the settings container
function showSettings() {
	if (!settings) {
		return;
	}

	qs(".settings").style.display = "flex";

	for (let item in settings) {
		if (typeof settings[item] === "boolean") {
			qs("input[name=" + item + "]").checked = settings[item];
			continue;
		}
		qs("input[name=" + item + "]").value = settings[item];
	}
}

// hide the settings container
function hideSettings() {
	qs(".settings").style.display = "none";
}

// save settings
function saveSettings() {
	// for (let input of Array.prototype.slice.call(document.querySelectorAll(".settings input"))) {
	// 	if (input.type === "checkbox") {
	// 		settings[input.name] = input.checked;
	// 		continue;
	// 	}
	// 	settings[input.name] = input.type === "number" ? Number(input.value) : input.value;
	// }
	hideSettings();
}

// get list of users reported to AIV
async function updateAIVReports() {
	const AIVregex = /{{(?:ip)?vandal\|(?:1=)?(.+?)}}/gmi;
	try {
		const pages = (await antiVandalApi.get({
			action: "query",
			format: "json",
			prop: "revisions",
			titles: "Wikipedia:Administrator_intervention_against_vandalism|Wikipedia:Administrator_intervention_against_vandalism/TB2",
			formatversion: 2,
			rvprop: "content",
			rvslots: "*"
		})).query.pages;

		currentAIVReports = [...pages[0].revisions[0].slots.main.content.matchAll(AIVregex)]
			.concat([...pages[1].revisions[0].slots.main.content.matchAll(AIVregex)])
			.map(e => e[1]);
	} catch (err) {
		console.log(err);
	}
}

// check if a user is reported to AIV
function checkIfReported(user) {
	for (let username of currentAIVReports) {
		if (username.toLowerCase() === user.toLowerCase()) {
			return true;
		}
	}

	return false;
}

// add report for user
async function reportUserToAIV(user, reason) {
	await updateAIVReports();
	if (checkIfReported(user)) {
		return;
	}
	qs(".diffProgressContainer").innerHTML += `
		<div class="diffProgressBar" id="report-${reportNum}">
			<div class="diffProgressBarOverlay"></div>
			<div class="diffProgressBarText">Getting AIV page...</div>
		</div>
	`;

	const progressBarId = "#report-" + reportNum;
	const overlayId = "#report-" + reportNum + " > .diffProgressBarOverlay";
	const textId = "#report-" + reportNum + " > .diffProgressBarText";
	reportNum++;
	qs(overlayId).style.background = "orange";

	// from https://melvingeorge.me/blog/check-if-string-is-valid-ipv6-address-javascript
	const ipv6Regex = /(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))/gi;

	let template = "Vandal";
	if (user.match(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/) || user.match(ipv6Regex)) {
		template = "IPvandal";
	}

	const text = "\n* {" + "{" + template + "|" + user + "}} &ndash; " + reason + " ~~" + "~~";

	qs(overlayId).style.width = "50%";
	qs(textId).innerText = "Reporting...";

	try {
		const AIVcontent = (await antiVandalApi.get({
			action: "query",
			format: "json",
			prop: "revisions",
			titles: "Wikipedia:Administrator_intervention_against_vandalism",
			formatversion: 2,
			rvprop: "content|ids",
			rvslots: "*"
		})).query.pages[0].revisions[0];
	
		await antiVandalApi.post({
			action: "edit",
			format: "json",
			title: "Wikipedia:Administrator_intervention_against_vandalism",
			summary: `Reporting [[Special:Contributions/${user}|${user}]] ([[User:Ingenuity/AntiVandal|AV]])`,
			text: AIVcontent.slots.main.content + text,
			token: await getCSRFToken(),
			baserevid: AIVcontent.revid
		});
	} catch (err) {
		console.log(err);
	}

	qs(overlayId).style.width = "100%";
	qs(textId).innerText = "Done";
	hideProgressBar(progressBarId)
}

function reportCurrentUser() {
	const user = currentEdit.user;
	if (qs("#past-final-warning").checked) {
		reportUserToAIV(user, "Vandalism past final warning.");
	} else if (qs("#vandalism-only-acc").checked) {
		reportUserToAIV(user, "Evidently a vandalism-only account.");
	} else if (qs("#other-reason").checked) {
		reportUserToAIV(user, qs("#report-reason").value);
	}
	qs("#report-menu").click();
}

runAntiVandal();

/* </nowiki> */