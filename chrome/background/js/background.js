require(["SettingsHandler", "tts/TtsProvider","icon/drawer"], function(settingsHandler, tts, iconDrawer) {

	//===================================== Google Anyltics =====================================
	(function(i,s,o,g,r,a,m){i['GoogleAnalyticsObject']=r;i[r]=i[r]||function(){
	(i[r].q=i[r].q||[]).push(arguments)},i[r].l=1*new Date();a=s.createElement(o),
	m=s.getElementsByTagName(o)[0];a.async=1;a.src=g;m.parentNode.insertBefore(a,m)
	})(window,document,'script','https://ssl.google-analytics.com/analytics.js','analytics');

	analytics('create', 'UA-67507804-1', 'auto');	//create tracker
	analytics('set', 'checkProtocolTask', function(){})	//https://code.google.com/p/analytics-issues/issues/detail?id=312
	analytics('set', 'page', '/background');
	
	//some events occour many times in a short period
	//e.g. speed change is received many times while user moves the range, or click event received if user double or triple clicks
	//in order NOT to send too many analytics request, we only send an event if 1 sec passed after the last event
	var event2scheduledAnalytics = {};
	function scheduleAnalytics(category, action, label) {	//an event is basically a category + action + label. NOTE: label is not part of the key, the last set label will be sent, not all
		var key = JSON.stringify([category, action]);	//stringify so keys are compared based on value and not reference

		var scheduled = event2scheduledAnalytics[key];
		if(scheduled) clearTimeout(scheduled);
		
		scheduled = window.setTimeout(function() {
			event2scheduledAnalytics[key] = undefined;
			analytics('send', 'event', category, action, label);
		}, 1000);
		event2scheduledAnalytics[key] = scheduled;
	}
	
	// ===================================== handle messages =====================================

	var iconCanvas = document.createElement("canvas");
	//19px is the size of the icons https://developer.chrome.com/extensions/browserAction#icon
	iconCanvas.width = iconCanvas.height = 18;
	iconDrawer.canvas = iconCanvas;
	iconDrawer.onRenderFinished = loadIconToToolbar;
	
	var userInteractionAudio = new Audio();
	userInteractionAudio.src = "pop.wav";
	userInteractionAudio.volume = 0.6;
	
	/** iconDrawer draws the icon on a canvas, this function shows the canvas on the toolbar */
	function loadIconToToolbar() {
		chrome.browserAction.setIcon({
			imageData: iconCanvas.getContext("2d").getImageData(0, 0, 19, 19)
		});
	}
	
	function read(c) {
		settingsHandler.getAll(function(settings) {
			if(! settings.turnedOn) {return;}
			tts.read({text:c.text,lan:c.lan,speed:settings.speed});
		});
	}
	
	/** notifies all content scripts */
	function notifyContentJs(message) {
		chrome.tabs.query({}, function(tabs) {
			for (var i=0; i<tabs.length; i++) {
				chrome.tabs.sendMessage(tabs[i].id, message);
			}
		});
	}
	
	function onTtsEvent(event) {
		notifyContentJs({action:"event", event:event});
		
		//analytics
		switch(event.type) {
			case("start"): scheduleAnalytics('tts', 'start'); break;
			case("error"): scheduleAnalytics('tts', 'error'); break;
		}
		
		//icon
		switch(event.type) {
			case("loading"): iconDrawer.drawLoading(); break;
			case("start"): iconDrawer.drawPlaying(); break;
			case("end"): iconDrawer.drawTurnedOn(); break;
			case("error"): iconDrawer.drawError(); break;
		}
	}
	
	function set(setting, value) {
		settingsHandler.set(setting,value);
		switch(setting) {
			case("turnedOn"):
				if(value) {
					tts.onEvent = onTtsEvent;
					iconDrawer.drawTurnedOn();
				}
				else {
					tts.onEvent = null;	//so the 'end' event wont redraw the icon
					tts.read({text:""});	//in case it is reading, we stop it
					iconDrawer.drawTurnedOff();
				}
				notifyContentJs({action:"set", setting:setting, value:value});
				break;
			case("speed"): tts.speed = value; break;
			case("hoverSelect"):
			case("arrowSelect"):
			case("browserSelect"): notifyContentJs({action:"set", setting:setting, value:value});break;
		}
	}
	
	//receiving messages from cotnent script (to read) and popup (turnon/turnoff/getstatus)
	chrome.runtime.onMessage.addListener(
		function(request, sender, sendResponse) {
			switch(request.action) {
				case("getSettings"):
					settingsHandler.getAll(function(settings){
						sendResponse(settings);
					});
					return true;	//keeps sendResponse channel open until it is used
				case("set"):
					set(request.setting,request.value);
					scheduleAnalytics('set', request.setting, request.value);
					break;
				case("getTtsProperties"): sendResponse(tts.ttsProperties); break;
				case("testTtsService"): tts.test(request.tts, sendResponse); return true;	//return true keeps sendResponse channel open until it is used
				case("getErrors"): sendResponse(tts.errors); break;
				case("getLastTtsEvent"): sendResponse(tts.lastEvent); break;
				case("read"): read({text: request.text,lan: request.lan || navigator.language}); break;
				case("stepHighlight"):
					settingsHandler.getAll(function(settings) {
						userInteractionAudio.currentTime = 0;
						userInteractionAudio.play();
					});
					iconDrawer.drawInteraction();
					break;
			}
		}
	);

	// ===================================== initial settings =====================================
	settingsHandler.getAll(function(settings) {
		tts.preferredTts = settings.preferredTts;
		tts.speed = settings.speed;
		tts.onEvent = settings.turnedOn?onTtsEvent:null;
		if(settings.turnedOn) iconDrawer.drawTurnedOn();
		else iconDrawer.drawTurnedOff();
	});
});
