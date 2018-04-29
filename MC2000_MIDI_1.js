/**
 * Denon MC2000 4 deck controller script for Mixxx v2.1
 *
 * Based on work by Esteban Serrano Roloff.
 *
 * 2014/03/2 V0.6.2 :	Functional & relatively untested version.
 *			Bug where play control would	become unresponsive after pressing hotcues fixed.
 *
 * Inspired by
 * Bertrand Espern's Denon MC3000 controller script V0.995, and
 * Borfo's Korg Nanocontrol2 controller script V2.2.
 *
 **/

var mc2000 ={};

// ----------   Global variables    ----------

// MIDI Reception commands (from spec)
mc2000.leds = {
	shiftlock: 		2,
	vinylmode: 		6,
	keylock: 		8,
	sync: 			9,

	cue1: 			17,
	cue2: 			19,
	cue3: 			21,
	cue4: 			23,

	samp1_l: 		25,
	samp2_l: 		27,
	samp3_l: 		29,
	samp4_l: 		32,

	samples_l: 		35,
	samp1_r: 		65,
	samp2_r: 		67,
	samp3_r: 		69,
	samp4_r: 		71,
	samples_r: 		73,
	cue: 			38,
	play: 			39, // was wrong in the spec sheet as decimal value

	loopin: 		36,
	loopout: 		64,
	autoloop: 		43,
	fx1_1: 			92,

	fx1_2: 			93,
	fx1_3: 			94,
	fx2_1: 			96,
	fx2_2: 			97,

	fx2_3: 			98,
	// "ALL SLIDER/VOLUME/FADER REQUEST": 57,
	monitorcue_l: 	69,
	monitorcue_r: 	81
};
mc2000.decks = ["_l","_r"];
mc2000.state = {"shift": false, "shiftlock": false,"effects1":false,"effects2":false};
mc2000.control2CueNo = { 0x17: 1, 0x18: 2, 0x19: 3, 0x20: 4 };

var jog1divide = 0;
var jog2divide = 0;
// ----------   Functions    ----------

// Called when the MIDI device is opened & set up.
mc2000.init = function(id, debug) {

	mc2000.id = id;
	mc2000.debug = debug;


	// ---- Connect controls -----------

	// ---- Controls for Channel 1 and 2

	var i=0;
	for (i=1; i<=4; i++) {

		// Key lock
		engine.connectControl("[Channel"+i+"]", "keylock", "mc2000.keylockSetLed");
		// Sync
		engine.connectControl("[Channel"+i+"]", "beat_active", "mc2000.beatActiveSetLed");

		// Cue 1-4
		var j=0;
		for (j=1;j<=4;j++) {
			engine.connectControl("[Channel"+i+"]","hotcue_"+j+"_enabled","mc2000.hotcueSetLed");
			engine.connectControl('[EffectRack1_EffectUnit'+j+']','group_[Channel'+i+']_enable','mc2000.sampleXSetLed');
		}

		// Cue
		engine.connectControl("[Channel"+i+"]", "cue_cdj", "mc2000.cueSetLed");
		// Play
		engine.connectControl("[Channel"+i+"]", "play", "mc2000.playSetLed");

		// Loop in
		engine.connectControl("[Channel"+i+"]", "loop_start_position", "mc2000.loopStartSetLed");
		// Loop out
		engine.connectControl("[Channel"+i+"]", "loop_end_position", "mc2000.loopEndSetLed");
		// Auto loop (actually reloop/exit)
		engine.connectControl("[Channel"+i+"]", "loop_enabled", "mc2000.loopEnableSetLed");

		// FX 1-3
		engine.connectControl("[Channel"+i+"]", "beatloop_1_enabled", "mc2000.beatLoopXSetLed");
		engine.connectControl("[Channel"+i+"]", "beatloop_2_enabled", "mc2000.beatLoopXSetLed");
		engine.connectControl("[Channel"+i+"]", "beatloop_4_enabled", "mc2000.beatLoopXSetLed");

		// Monitor cue
		engine.connectControl("[Channel"+i+"]", "pfl", "mc2000.pflSetLed");

	}


	for (i=1; i<=4; i++) {
		engine.softTakeover("[Channel"+i+"]", 'volume', true);
		engine.softTakeover("[Channel"+i+"]", 'rate', true);
		engine.softTakeover("[Channel"+i+"]", 'pregain', true);
		engine.softTakeover("[EqualizerRack1_[Channel"+i+"]_Effect1]", "parameter1",true);
		engine.softTakeover("[EqualizerRack1_[Channel"+i+"]_Effect1]", "parameter2",true);
		engine.softTakeover("[EqualizerRack1_[Channel"+i+"]_Effect1]", "parameter3",true);
		engine.softTakeover("[QuickEffectRack1_[Channel"+i+"]", "super1",true);

	}
	// Soft takeover for faders



	// Put all LEDs on default state.
	mc2000.allLed2Default();
};


mc2000.deck = {
    // a hash table (technically an object) to store which deck each side of the controller is manipulating
    // The keys (object properties) on the left represent the <group> elements in the XML mapping file.
    // The values on the right represent which deck that set of mappings in the XML file is currently controlling.
    // These values are toggled between [Channel1]/[Channel3] and [Channel2]/[Channel4] by the deckToggleButton function below.
    // see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Object_initializer
    '[Channel1]': '[Channel1]',
    '[Channel2]': '[Channel2]',

}
mc2000.buttons = { // a hash table that stores the MIDI notes that correspond to LED backlit buttons
    '[Channel1]': {
        'deckToggle': 0x06,
				'play':0x40
        // Add any other LEDs for decks 1/3 here
     },
     '[Channel2]': {
        'deckToggle': 0x06
        // Add any other LEDs for decks 2/4 here
     }
}
mc2000.buttons['[Channel3]'] = mc2000.buttons['[Channel1]'] // Copy [Channel1] to [Channel3]
mc2000.buttons['[Channel4]'] = mc2000.buttons['[Channel2]'] // Copy [Channel2] to [Channel4]

mc2000.channelRegEx = /\[Channel(\d+)\]/;

mc2000.initDeck = function (group) { // This function is not mapped to a MIDI signal; it is only called by this script in the init and deckToggleButton functions
    // Execute code to set up the controller for manipulating a deck
    // Putting this code in a function allows you to call the same code from the script's init function and the deckToggleButton function without having to copy and paste code

    // Figure out which deck was being controlled before so automatic reactions to changes in Mixxx (see above) can be disabled for that deck
    var disconnectDeck = parseInt(mc2000.channelRegEx.exec(group)[1])
    if (disconnectDeck <= 2) {
        disconnectDeck += 2
    } else {
        disconnectDeck -= 2
    }

		engine.softTakeoverIgnoreNextValue("[Channel"+disconnectDeck+"]", "volume");
		engine.softTakeoverIgnoreNextValue("[Channel"+disconnectDeck+"]", "rate");
		engine.softTakeoverIgnoreNextValue("[Channel"+disconnectDeck+"]", "pregain");
		engine.softTakeoverIgnoreNextValue("[EqualizerRack1_[Channel"+disconnectDeck+"]_Effect1]", "parameter1");
		engine.softTakeoverIgnoreNextValue("[EqualizerRack1_[Channel"+disconnectDeck+"]_Effect1]", "parameter2");
		engine.softTakeoverIgnoreNextValue("[EqualizerRack1_[Channel"+disconnectDeck+"]_Effect1]", "parameter3");
		engine.softTakeoverIgnoreNextValue("[QuickEffectRack1_[Channel"+disconnectDeck+"]]", "super1",true);
		mc2000.connectDeckControls(group) // connect new deck's Mixxx controls to LEDs
    // Toggle LED that indicates which deck is being controlled
		//engine.setValue(group, 'vinylcontrol_status', !(engine.getValue(group, 'vinylcontrol_status')));
}

mc2000.connectDeckControls = function (group) {

var channel = group[8];
	if(channel>2){channel-=2;}
	for (j=1; j<=4; j++) {
	var _channel = mc2000.decks[channel-1];
			mc2000.setLed(channel,mc2000.leds["samp"+j+_channel],engine.getValue('[EffectRack1_EffectUnit'+j+']','group_'+group+'_enable'));
	}

// This hash table maps Mixxx controls to the script functions (not shown in this example) that control LEDs that react to changes in those controls
		var controlsToFunctions = {
        'play': 'mc2000.playSetLed',
				'beat_active':'mc2000.beatActiveSetLed',
				'pfl':'mc2000.pflSetLed',
				'loop_start_position': 'mc2000.loopStartSetLed',
				'loop_end_position': 'mc2000.loopEndSetLed',
				'loop_enabled': 'mc2000.loopEnableSetLed',
				'beatloop_1_enabled': 'mc2000.beatLoopXSetLed',
 				'beatloop_2_enabled': 'mc2000.beatLoopXSetLed',
 				'beatloop_4_enabled':'mc2000.beatLoopXSetLed',
				'hotcue_1_enabled':'mc2000.hotcueSetLed',
				'hotcue_2_enabled':'mc2000.hotcueSetLed',
				'hotcue_3_enabled':'mc2000.hotcueSetLed',
				'hotcue_4_enabled':'mc2000.hotcueSetLed',
				'keylock':'mc2000.keylockSetLed',

    }
engine.connectControl(group,'beat_active',true);

    for (var control in controlsToFunctions) { // For each property (key: value pair) in controlsToFunctions, control = that property of controlsToFunctions
                                               // see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for...in
eval(controlsToFunctions[control])(engine.getValue(group,control), group,control);

    }
}

// Called when the MIDI device is closed
mc2000.shutdown = function(id) {
	// Put all LEDs on default state.
	mc2000.allLed2Default();
};


// === FOR MANAGING LEDS ===

mc2000.allLed2Default = function () {
	// All leds OFF for deck 1 and 2
	for (var led in mc2000.leds) {
		mc2000.setLed(1,mc2000.leds[led],0);
		mc2000.setLed(2,mc2000.leds[led],0);
	}

	// Monitor cue leds OFF for deck 1 and 2 (use function setLed2)
	mc2000.setLed2(1,mc2000.leds["monitorcue_l"],0);
	mc2000.setLed2(2,mc2000.leds["monitorcue_r"],0);

	// Vinylmode ON
	mc2000.setLed(1,mc2000.leds["vinylmode"],1);
	mc2000.setLed(2,mc2000.leds["vinylmode"],1);
};


mc2000.setLed = function(deck,led,status) {
	var ledStatus = 0x4B; // Default OFF
	switch (status) {
		case 0: 	ledStatus = 0x4B; break; // OFF
		case false: ledStatus = 0x4B; break; // OFF
    	case 1: 	ledStatus = 0x4A; break; // ON
		case true: 	ledStatus = 0x4A; break; // ON
    	case 2: 	ledStatus = 0x4C; break; // BLINK
    	default: 	break;
	}

if(deck>2){deck-=2;}
	midi.sendShortMsg(0xB0+(deck-1), ledStatus, led);
};

mc2000.setLed2 = function(deck,led,status) {

	if(deck<=2){
	midi.sendShortMsg(0xB0+(deck-1), status==1 ? 0x50 : 0x51, led);
} else {
	midi.sendShortMsg(0xB0+(deck-3), status==1 ? 0x50 : 0x51, led);
}
};




// === MISC COMMON ===

mc2000.group2Deck = function(group) {

	if(!group){return -1;}
	var matches = group.match(/^\[Channel(\d+)\]$/);
	if (matches == null) {
		return -1;
	} else {
		return matches[1];
	}
};

mc2000.loop2NoEfx = function(nbloop) {
	if (nbloop==1) nbloop=16;
	var v = (Math.log(nbloop)/Math.log(2));
 //2 4 8 16 -> 1 2 3 4
	return v;
};




// === GENERAL ===
mc2000.shift = function(channel, control, value, status, group) {
	// Declare shift pressed if button is down.
	mc2000.state["shift"] = (status === 0x90);

	// Change LED states if action is possible
	//mc2000.triggerAllSampleReplayControls();
	//mc2000.triggerAllHotcueControls();

};


mc2000.triggerAllSampleReplayControls = function(){
	var sampNo=0;
	for (sampNo=1; sampNo<=4; sampNo++)
	{
		engine.trigger("[Sampler"+sampNo+"]","play");
	}
};


mc2000.triggerAllHotcueControls = function(){
	// Channels 1-2
	var ch=0;
	for (ch=1; ch<=4; ch++) {
		// Cue 1-4
		var cueNo=0;
		for (cueNo=1;cueNo<=4;cueNo++) {
			engine.trigger("[Channel"+ch+"]","hotcue_"+cueNo+"_enabled");
		}
	}
};


mc2000.deckToggleButton = function(channel, control, value, status, group){
 // only execute the below code when the button is pressed but not when it is released
        // First, get the number out of the string '[Channel1]' ... '[Channel4]'

        var deckNumber = parseInt(mc2000.channelRegEx.exec(mc2000.deck[group])[1] // Get the string that matches the part of the regular expression inside the first group of parentheses in the regular expression
                                  // which is (\d+)
                                  // this matches any number of digits
                          )
        if (deckNumber <= 2) {
            deckNumber += 2 // This is a shortcut for 'deckNumber = decknumber + 2'
        } else {
            deckNumber -= 2 // This is a shortcut for 'deckNumber = decknumber - 2'
        }

        mc2000.deck[group] = '[Channel' + deckNumber + ']'
        mc2000.initDeck(mc2000.deck[group]) // Initialize the new deck. This function is defined below.

};

// === PLAYLIST ===
mc2000.selectKnob = function(channel, control, value, status, group) {
	// NORMAL MODE - NEXT/PREV TRACK
	if (value == 0x01) {
		engine.setValue(group, "SelectNextTrack", 1);
	} else {
		engine.setValue(group, "SelectPrevTrack", 1);
	}
};



// === PLAYBACK ===
mc2000.bendUpOrFf = function(channel, control, value, status, group) {
group = mc2000.deck[group];
	if ((status & 0xF0)===0x90){ // If button down

		if (mc2000.state["shift"] === true) {
			// Fast-forward if shift is pressed too
			// TODO: Change for a VDJ-like FF (jump 4 beats)
			engine.setValue(group, "fwd", true);
		}else{
			// Bend up
			engine.setValue(group, "rate_temp_up", true);
		}
	}
	else{ // Button up
		engine.setValue(group, "fwd", false);
		engine.setValue(group, "rate_temp_up", false);
	}

};

mc2000.bendDnOrRew = function(channel, control, value, status, group) {
group = mc2000.deck[group];
	if ((status & 0xF0)===0x90){ // If button down

		if (mc2000.state["shift"] === true) {
			// Fast-rewind if shift is pressed too
			// TODO: Change for a VDJ-like REW (jump 4 beats)
			engine.setValue(group, "back", true);
		}else{
			// Bend down
			engine.setValue(group, "rate_temp_down", true);
		}
	}
	else{ // Button up
		engine.setValue(group, "back", false);
		engine.setValue(group, "rate_temp_down", false);
	}
};


mc2000.beatsKnobTurn = function(channel, control, value, status, group) {
	// Knob turning direction
		var fwd = false;
	if (value === 0x01){
		fwd = true;
	}
	group = mc2000.deck[group];
	var size =engine.getValue(group,'beatloop_size');

	// Different action if shift down
	if (mc2000.state["shift"] === true) {
		// If shift is pressed, adjust the samplers volume (currently all of them will be updated at the same time)
		if(fwd)
		{engine.setParameter(group, "loop_move_"+size+"_forward", 1);}
		else
		 {engine.setParameter(group, "loop_move_"+size+"_backward", 1);}

	} else {
		if(fwd)
		{engine.setParameter(group, "beatloop_size", size*2);}
		else
		{engine.setParameter(group, "beatloop_size", size/2);}

	}
};


// === HOT CUES ===
mc2000.hotcueActivateOrDelete = function(channel, control, value, status, group) {
  group = mc2000.deck[group];
	var cueNo = mc2000.control2CueNo[control];

	if ((status & 0xF0) === 0x90) {    // If button down
		if (mc2000.state["shift"] === true) {
			// If shift is pressed, delete cue
			engine.setValue(group, "hotcue_"+cueNo+"_clear", true);
		}else{
			// Set or play cue
			engine.setValue(group, "hotcue_"+cueNo+"_activate", true);
		}
	}
	else{
		// Fixes bug described here: https://bugs.launchpad.net/mixxx/+bug/1280694
		engine.setValue(group, "hotcue_"+cueNo+"_activate", false);
	}
};

// === JOG WHEEL ===

// The button that enables/disables scratching
mc2000.wheelTouch = function(channel, control, value, status, group){

	  group = mc2000.deck[group];
		var deck = mc2000.group2Deck(group)

	if (value) {    // If button down

				var alpha = 1.0/8;
        var beta = alpha/32;
        var rpm = 200.0;
        if (mc2000.state["shift"] === true) // If shift is pressed, do a fast search
        	rpm = 10.0;

        engine.scratchEnable(deck, 128, rpm, alpha, beta, true);
    }
    else {    // If button up
        engine.scratchDisable(deck);

    }
};


// The wheel that actually controls the scratching
mc2000.wheelTurn = function(channel, control, value, status, group) {
	group = mc2000.deck[group];

var deck = mc2000.group2Deck(group);

   var newValue=(value-64);

    engine.scratchTick(deck,newValue);
 if ( engine.isScratching(deck)) {

engine.scratchTick(deck,newValue);
  }
else {
 if (engine.getValue(group,"play") != 0) {

engine.setValue(group,"jog", (value-0x40)/8);
                          }
 }
};




// === SET LED FUNCTIONS ===

mc2000.hotcueSetLed = function(value, group, control) {
	// If in shift mode, currently set hotcues should blink,
	// which indicates they can be deleted by pressing the blinking button.
	if (mc2000.state["shift"] === true && value === 1) {
		value = 2;
	}

	mc2000.setLed(mc2000.group2Deck(group),mc2000.leds["cue"+control[7]],value);
};

mc2000.pflSetLed = function(value, group) {

	var g =  mc2000.group2Deck(group); if(g>2){g-=2;}

	var side = g == 1 ? 'l' : 'r';

	mc2000.setLed2(g,mc2000.leds["monitorcue_"+side],value);
};

mc2000.playSetLed = function(value, group) {
	mc2000.setLed(mc2000.group2Deck(group),mc2000.leds["play"],value);
};

mc2000.cueSetLed = function(value, group) {
		mc2000.setLed(mc2000.group2Deck(group),mc2000.leds["cue"],value);
};

mc2000.keylockSetLed = function(value, group) {

	group = mc2000.group2Deck(group);
	if(group>2){group-=2;}
	mc2000.setLed(group,mc2000.leds["keylock"],value);
};

mc2000.loopStartSetLed = function (value, group) {
	var deck = mc2000.group2Deck(group);
	if(deck>2){deck-=2;}
	mc2000.setLed(deck,mc2000.leds["loopin"],value == -1 ? false: true);
};

mc2000.loopEndSetLed = function (value, group) {
	var deck = mc2000.group2Deck(group);
	if(deck>2){deck-=2;}
	mc2000.setLed(deck,mc2000.leds["loopout"],value == -1 ? false: true);
};

mc2000.loopEnableSetLed = function(value, group, control) {
	var deck = mc2000.group2Deck(group);
	if(deck>2){deck-=2;}
	mc2000.setLed(deck,mc2000.leds["autoloop"],value);
};

mc2000.beatLoopXSetLed = function(value, group, control) {

	var deck = mc2000.group2Deck(group);if(deck>2){deck-=2;}
	var noEfx = mc2000.loop2NoEfx(control[9]*2);

	// From the spec, all fx leds are in MIDI CH1 range.
	// First parameter is hardcoded.
	mc2000.setLed(1,mc2000.leds["fx"+deck+"_"+noEfx],value);
};

mc2000.sampleXSetLed = function(value, group, control) {

 var deck = control[14]
 if(deck>2){deck-=2;}
 var channel = mc2000.decks[deck-1];
var noSamp = group[23];
	// If in shift mode, currently playing samples should blink,
	// which indicates they can be stopped by pressing the blinking button.
	if (mc2000.state["shift"] === true && value === 1) {
		value = 2;
	}

	mc2000.setLed(deck,mc2000.leds["samp"+noSamp+channel],value);
};

mc2000.beatActiveSetLed = function (value, group){
	mc2000.setLed(mc2000.group2Deck(group),mc2000.leds["sync"],value);
};

mc2000.fxtoggle = function (channel, control, value, status, group) {
	group = 'group_'+mc2000.deck[group]+'_enable';
	unit = '[EffectRack1_EffectUnit'+control%16+']';

	if (value) {
			engine.setValue(unit,group,!engine.getValue(unit,group))
}
}


mc2000.playButton = function (channel, control, value, status, group) {
		group = mc2000.deck[group];
		var playing = engine.getValue(group,"play");
		if (mc2000.state["shift"] === true && playing != 0) {engine.setValue(group,'reverseroll',!(engine.getValue(group,'reverseroll')));return;}
    if (value) {
			if(engine.getValue(group,'reverseroll')==1){
			engine.setValue(group,'reverseroll',0);
			return;
		}
  engine.setValue(group, 'play', !(playing));
}
};

mc2000.volume = function (channel, control, value, status, group) {
    group = mc2000.deck[group];

		//	engine.softTakeover(group, 'volume', true);

  engine.setValue(group, 'volume', script.absoluteLin(value, 0, 1));

};

mc2000.pregain = function (channel, control, value, status, group) {
    group = mc2000.deck[group];

		//	engine.softTakeover(group, 'volume', true);
  engine.setParameter(group, "pregain", script.absoluteLin(value,0,1));
//  engine.setValue(group, 'pregain', script.absoluteLin(value, 0, 4));
};

mc2000.effects = function (channel, control, value, status, group) {
	if(value){
  group = mc2000.deck[group];
	var deck = group[8];
	if(deck>2){deck-=2;}
	var channel = mc2000.decks[group[8]-1];
	mc2000.state["effects1"] = (status === 0x90);
	mc2000.state["effects2"] = (status === 0x91);
		for (i=1; i<=4; i++) {
				mc2000.setLed(deck,mc2000.leds["samp"+i+channel],engine.getValue('[EffectRack1_EffectUnit'+i+']','group_'+group+'_enable'));
		}
}
}
mc2000.rate = function (channel, control, value, status, group) {
    group = mc2000.deck[group];
    if (value) {
			engine.softTakeover(group, 'rate', true);

  engine.setValue(group, 'rate', script.absoluteLin(value, -1, 1));
}
};
mc2000.loadSelectedTrack = function(channel, control, value, status, group) {
  group = mc2000.deck[group];

		if (mc2000.state["shift"] === true) {
	//		group = group.replace('Channel','Sampler');
		//	engine.setValue(group, "LoadSelectedTrack", 1);
		//	engine.setValue(group, "beatsync", 1);
		} else {
	engine.setValue(group, "LoadSelectedTrack", 1);
	engine.setValue(group, "pfl", 1);
}


}

mc2000.beatsync = function(channel, control, value, status, group) {
  group = mc2000.deck[group];
	if(value){
	engine.setValue(group, "beatsync", 1);
}

}
mc2000.pfl = function(channel, control, value, status, group) {
  group = mc2000.deck[group];
	if(value){
	engine.setValue(group, "pfl", !(engine.getValue(group, 'pfl')));
}
}

mc2000.slipmode = function(channel, control, value, status, group) {
  group = mc2000.deck[group];
	if(value){
	engine.setValue(group, "slip_enabled", !(engine.getValue(group, 'slip_enabled')));
}
}

mc2000.quantize = function(channel, control, value, status, group) {
  group = mc2000.deck[group];
	if(value){
	engine.setValue(group, "quantize", !(engine.getValue(group, 'quantize')));
}
}

mc2000.keylock = function(channel, control, value, status, group) {
  group = mc2000.deck[group];
	if(value){
	engine.setValue(group, "keylock", !(engine.getValue(group, 'keylock')));
}
}

mc2000.cue_default = function(channel, control, value, status, group) {
	group = mc2000.deck[group];
	if(value){
engine.setParameter(group, "cue_cdj", 1);
} else {
	engine.setParameter(group, "cue_cdj", 0);

}

}

mc2000.filterHigh = function (channel, control, value, status, group) {
    group = mc2000.deck[group];
    if (value) {
		engine.softTakeover("[EqualizerRack1_"+group+"_Effect1]", "parameter3",true);
  engine.setParameter("[EqualizerRack1_"+group+"_Effect1]", "parameter3", script.absoluteLin(value,0,.99));
//  engine.setValue(group, 'filterHigh', script.absoluteNonLin(value, -1, 1));
}
};

mc2000.filterMid = function (channel, control, value, status, group) {
    group = mc2000.deck[group];
    if (value) {
			engine.softTakeover("[EqualizerRack1_"+group+"_Effect1]", "parameter2",true);
		engine.setParameter("[EqualizerRack1_"+group+"_Effect1]", "parameter2", script.absoluteLin(value,0,.99));
}
};
mc2000.filterLow = function (channel, control, value, status, group) {
    group = mc2000.deck[group];
    if (value) {
engine.softTakeover("[EqualizerRack1_"+group+"_Effect1]", "parameter1",true);
		engine.setParameter("[EqualizerRack1_"+group+"_Effect1]", "parameter1", script.absoluteLin(value,0,.99));
}
};

mc2000.quickfx = function (channel, control, value, status, group) {
    group = mc2000.deck[group];
    if (value) {
engine.softTakeover("[QuickEffectRack1_"+group+"]", "super1",true);
		engine.setParameter("[QuickEffectRack1_"+group+"]", "super1", script.absoluteLin(value,0,.99));

}
};

mc2000.fx1 = function (channel, control, value, status, group) {
    if (value) {
			if (mc2000.state["shift"] === true) {
				engine.softTakeover("[EffectRack1_EffectUnit1_Effect1]", "parameter2",true);
				engine.setParameter("[EffectRack1_EffectUnit1_Effect1]", "parameter2", script.absoluteLin(value,0,.99));
				return;
			}
		engine.softTakeover("[EffectRack1_EffectUnit1]", "super1",true);
		engine.setParameter("[EffectRack1_EffectUnit1]", "super1", script.absoluteLin(value,0,.99));

}
};

mc2000.fx2 = function (channel, control, value, status, group) {
    if (value) {
engine.softTakeover("[EffectRack1_EffectUnit2]", "super1",true);
		engine.setParameter("[EffectRack1_EffectUnit2]", "super1", script.absoluteLin(value,0,.99));

}
};

mc2000.fx3 = function (channel, control, value, status, group) {
    if (value) {
engine.softTakeover("[EffectRack1_EffectUnit3]", "super1",true);
		engine.setParameter("[EffectRack1_EffectUnit3]", "super1", script.absoluteLin(value,0,.99));

}
};
mc2000.fx4 = function (channel, control, value, status, group) {
    if (value) {
engine.softTakeover("[EffectRack1_EffectUnit4]", "super1",true);
		engine.setParameter("[EffectRack1_EffectUnit4]", "super1", script.absoluteLin(value,0,.99));

}
};
mc2000.loop_double = function(channel, control, value, status, group) {
  group = mc2000.deck[group];
	if(value){
	engine.setValue(group, "loop_double", 1);
}
}

mc2000.loop_halve = function(channel, control, value, status, group) {
  group = mc2000.deck[group];
	if(value){
	engine.setValue(group, "loop_halve", 1);
}
}

mc2000.beatloop_2_toggle = function(channel, control, value, status, group) {
  group = mc2000.deck[group];

	engine.setValue(group, "beatloop_1_toggle", !(engine.getValue(group, 'beatloop_1_toggle')));

}

mc2000.beatloop_4_toggle = function(channel, control, value, status, group) {
  group = mc2000.deck[group];

	engine.setValue(group, "beatloop_2_toggle", !(engine.getValue(group, 'beatloop_2_toggle')));

}
mc2000.beatloop_8_toggle = function(channel, control, value, status, group) {
  group = mc2000.deck[group];

	engine.setValue(group, "beatloop_4_toggle", !(engine.getValue(group, 'beatloop_4_toggle')));
}

mc2000.reloop_exit = function(channel, control, value, status, group) {
  group = mc2000.deck[group];
	engine.setValue(group, "reloop_exit", 1);
}

mc2000.loop_in = function(channel, control, value, status, group) {
  group = mc2000.deck[group];
	if(value){
engine.setParameter(group, "loop_in", 1);
} else {
	engine.setParameter(group, "loop_in", 0);
}
}

mc2000.loop_out = function(channel, control, value, status, group) {
  group = mc2000.deck[group];
	if(value){
engine.setParameter(group, "loop_out", 1);
} else {
	engine.setParameter(group, "loop_out", 0);
}
}
