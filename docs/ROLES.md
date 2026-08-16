Master formatting:

# {Zone}
Situation rundown

## Roles

### Faction: {Faction}
{Role Name}
intro: {Public-facing one-line description}
- Summary point 1...
- Summary point 2...
- difficulty: {hard, normal, easy}
- starting tag: tag, tag
- doc elements: {element (ex:courtstructure)}, {element}, {element}

## Threats

--------

# Fortress
- The last tithe didn't arrive, and it shows. The banquets are a little less extravagant than usual. Pressure builds on the Meister—go talk to the Headman. Take whatever they can spare from their stores.
- A letter from the Bastard declaring his intents was found on the table. Since the Guards didn't see anyone come in, it's clear someone on the inside brought it in. There must be a traitor.
- To lift spirits, the Baron has offered the Successor's (or Heir's) hand in marriage. The Courtiers, suspecting each other to be traitors, rival for the betrothal.

## Roles

### Faction: The Court
Baron
intro: You are the ruler. Protect Ravenheart. Find a balance between staying happy and alive.
- You are the ruler. Protect your dynasty, and optionally your people. Find a balance between staying happy and alive.
- Your offices have a PA system that can be heard in intercoms throughout Ravenheart.
- Above all, be proactive. Ravenheart is a dangerous place. If you prepare well, you may keep the throne.
- difficulty: hard
- multiple: false
- starting tag: Royal Blood, Leader, Treasurer, Leader
- doc elements: courtstructure, lifewebbasic, fortressstarting, treasurer

Baroness
intro: Take care of your children. Be the Lioness, or succumb to anxiety.
- Take care of your children. Be the Lioness, or succumb to anxiety.
- difficulty: easy
- multiple: false
- starting tag: Royal Blood
- doc elements: courtstructure, lifewebbasic, fortressstarting

Heir
intro: You are your father’s son. Are you the exact opposite of him, or his closest ally?
- You are your father’s son. Are you the exact opposite of him, or his closest ally?
- difficulty: easy
- multiple: false
- starting tag: Royal Blood
- doc elements: courtstructure, lifewebbasic, fortressstarting

Successor
intro: You are the Baron’s daughter. Bring some light to the darkness.
- You are the Baron’s daughter. Bring some light to the darkness.
- difficulty: easy
- multiple: false
- starting tag: Royal Blood
- doc elements: courtstructure, lifewebbasic, fortressstarting

Hand
intro: You’re the Baron’s best friend and perhaps the only man he can truly trust.
- You’re the Baron’s best friend and perhaps the only man he can truly trust. You are completely loyal to him.
- The Baron works best when he’s informed and has a court that’s loyal and organized. You are his spymaster, his executor, his voice. Without you, Ravenheart collapses.
- Above all, be proactive. Ravenheart is a dangerous place. If you prepare well, the Baron may keep the throne. If you don’t, it won’t be long until someone kills him or makes a fool out of him.
- difficulty: normal
- multiple: false
- starting tag: Treasurer
- doc elements: courtstructure, lifewebbasic, fortressstarting, courtier

Meister
intro: You are the Keep’s brains, but more importantly, its circulatory system.
- You are the Keep’s brains, but more importantly, its circulatory system. Ensure the Town sends its taxes—your main contact there is the Headman—and oversee that no one is taking undue amounts of Resources from the Silo.
- Consider keeping records of what happens every day. They may be useful later.
- You have minor medical training and you know how to use the Keep’s messenger ravens. 
- difficulty: normal
- multiple: false
- starting tag: Intelligent, Frail, Treasurer, Medical (1), Ravenkeeper
- doc elements: courtstructure, lifewebbasic, fortressstarting, fortressstartingtithe, fortressstartingletter, courtier, ravens

Courtier
intro: Live lavishly and gossip.
- For whatever reason, the Baron keeps you around in his court. Convince the Captain to launch an expedition into the caves, host marvelous feasts, and duel your fellow courtiers for the Successor’s affection.
- difficulty: easy
- multiple: true
- starting tag: 
- doc elements: courtier, courtstructure, fortressstarting

Courtier (Manor Lord)
intro: Live in your manor, enjoy your wine, and participate in court politics.
- Live in your manor, enjoy your wine, and participate in court politics.
- difficulty: easy
- multiple: true
- parent role: Courtier
- starting tag: Manor
- doc elements: courtier, courtstructure, fortressstarting

Courtier (Manor Lady)
intro: Support your husband and maintain your manor.
- Support your husband and maintain your manor.
- difficulty: easy
- multiple: true
- parent role: Courtier
- starting tag: Manor
- doc elements: courtier, courtstructure, fortressstarting

Courtier (Minstrel)
intro: Compose ballads, smuggle drugs from the Town, and keep the Baron happy.
- Compose ballads, smuggle drugs from the Town (and peddle them to the courtiers), keep the Baron happy.
- difficulty: easy
- multiple: true
- parent role: Courtier
- starting tag: Musician
- doc elements: courtier, courtstructure, fortressstarting

Courtier (Old Knight)
intro: Reminisce about your valiant service against the Cult of Kosm in 1025.
- Reminisce about your valiant service against the Cult of Kosm in 1025. Polish your zweihander, take potions for your arthritis, and serve the Baron.
- difficulty: easy
- multiple: true
- parent role: Courtier
- starting tag: Fighter (Skilled), Arthritis, Old, Armor
- doc elements: courtier, courtstructure, fortressstarting

Courtier (Diplomat)
intro: Recover ancient artifacts and study Ravenheartian culture.
- Recover ancient artifacts and study Ravenheartian culture. Meddle. Convince the Baron to join your interstellar federation.
- difficulty: easy
- multiple: true
- parent role: Courtier
- starting tag: 
- doc elements: courtier, diplomat, courtstructure, fortressstarting

Servant
intro: Keep the fortress running.
- Keep the fortress running. Clean, cook, maintain, and serve.
- difficulty: easy
- multiple: true
- starting tag: 
- doc elements: courtier, cooking, courtstructure, fortressstarting

Servant (Chef)
intro: Prepare meals for the household and keep the kitchens running.
- Prepare meals for the household and keep the kitchens running.
- difficulty: easy
- multiple: true
- parent role: Servant
- starting tag: Cook (1), Cook (2)
- doc elements: courtier, cooking, fortressstarting, courtstructure


### Faction: The Watch
parent:The Court

Captain
intro: Bravely lead the Watch and hold back the darkness, you goddamn hero.
- Bravely lead the watch and hold back the darkness, you goddamn hero.
- difficulty: hard
- multiple: false
- starting tag: Fighter (Trained), Treasurer, Leader
- doc elements: courtstructure, fortressstarting, guard, treasurer

Incarn
intro: You are a warrior monk who serves Ravenheart.
- You are a warrior monk and you serve Ravenheart. You love goodness and hate evil.
- Your job is to guard the dungeon, process migrants, and protect the Silver Cross, Ravenheart's only relic. The Silver Cross is an ancient artifact, rumored to ward away evil.
- difficulty: normal
- multiple: false
- starting tag: Fighter (Skilled), Treasurer
- doc elements: courtstructure, fortressstarting, guard, treasurer, postchristianity

Guard
intro: Serve the Baron, salute your Captain, and hold back the tide of darkness.
- Serve the Baron, salute your Captain, and hold back the tide of darkness.
- difficulty: easy
- multiple: true
- starting tag: Fighter (Trained)
- doc elements: courtstructure, fortressstarting, guard

Squire
intro: Train. One day, you might become a knight.
- Train. One day, you might become a knight.
- difficulty: easy
- multiple: true
- starting tag: Fighter (Basic)
- doc elements: courtstructure, fortressstarting, guard

## Threats

Sympathizer (Fortress)
intro: Install the Bastard on the throne—by any means necessary.
- Your main goal: install the Bastard on the throne. To that end, turn the court against itself, scheme, and so on.
- You must also choose a second, self-serving goal. Ideas: kill the Baron in a dramatic way as revenge; kidnap the Heir or Successor (you're obsessed); take the Manor from the Lord and install yourself in it. In other words, figure out why you are personally invested in seeing this through.
- Be creative. Turn people against each other, convert people, cause incidents that make other people look bad. 
- starting tag: 
- doc elements:

Succubus (Fortress)
intro: You live for the thrill of enslaving souls and causing pain.
- You don't need to eat. Instead, you live for the thrill of enslaving souls and causing pain, and will become depressed if you don't. You gain Tag Points by enslaving souls.
- When you enslave a soul, that person has to follow your commands. You can only control up to two people at a time.
- You find normal crosses tacky and boring. Fire scares you somewhat—it definitely hurts. However, the Silver Cross terrifies you and burns you on touch.
- The Cult of Bacchus is active in the area. They'd love to have you at their parties, and may be tracking you down. Flee! They'll take your treasured independence.
- Choose your true form from the following: Satyr, Serpent, or Siren.
- You gain Tag Points by sleeping with people (+7), but you can also entertain yourself by capturing and torturing people (+4). You also gain points by making someone obsessed with you, either through romance, jealousy, or anger (+4).
- starting tag: 
- doc elements:

--------

# Town 
- The last tithe wagon didn't return from the Fortress—it was probably ambushed by bandits. The Meister won't be happy about this. Prepare to have the Silo drained.
- The Succubus takes souls while the Cult of Bacchus hosts ribald gatherings. The Church, followers of God, is split as the Order of the Silver Cross grows in power.
- The Inquisitor has planned an execution with the sheriff's permission. The Cult of Bacchus wants to break him out.

## Roles

### Faction: The Church
Bishop
intro: Lead the Church, and be a shining example of goodness in dark days.
- It is not the first time dark days have come to Ravenheart, but they are difficult times still. You hope the people will survive—God will ensure it. During this difficult transition, ensure you serve as a shining example of goodness.
- At some point, you will have to decide between peacefulness or the Order of the Silver Cross. 
- Along with the Priest, you have the power to dispel negative Tags of the psychological kind—the person must first confess to you, then spend a whole day in prayer (2 Efforts). 
- difficulty: normal
- multiple: false
- starting tag: Priest, Leader
- doc elements: townstarting, postchristianity

Priest 
intro: Care for the needy, lend an ear, and kindle goodness in others.
- It is not the first time dark days have come to Ravenheart. The people will survive—God will ensure it. During this difficult transition, ensure you serve as a shining example of goodness. Evil can only be held back with Truth—do not stoop to violence or zealotry.
- Care for the needy, lend an ear, and kindle goodness in others. Pay visits to the Fortress. Practice pacifism or support the Inquisition.
- Along with the Bishop, you have the power to dispel negative Tags of the psychological kind—the person must first confess to you, then spend a whole day in prayer (2 Efforts).
- difficulty: easy
- multiple: true
- starting tag: Priest
- doc elements: townstarting, postchristianity

Priest (Nun)
intro: Care for the needy, lend an ear, and kindle goodness in others.
- It is not the first time dark days have come to Ravenheart. The people will survive—God will ensure it. During this difficult transition, ensure you serve as a shining example of goodness. Evil can only be held back with Truth—do not stoop to violence or zealotry.
- Care for the needy, lend an ear, and kindle goodness in others. Pay visits to the Fortress. Practice pacifism or support the Inquisition.
- Along with the Bishop, you have the power to dispel negative Tags of the psychological kind—the person must first confess to you, then spend a whole day in prayer (2 Efforts). 
- difficulty: easy
- multiple: true
- parent role: Priest
- starting tag: Priest
- doc elements: townstarting, postchristianity

Scholastic
intro: Search for knowledge—occult or otherwise—and write your magnum opus.
- Earth is a speck in the infinite firmament. You have always been humbled—or perhaps energized—by the Truth. Try to understand it. Search for knowledge—occult or otherwise—and write your magnum opus. Be a hermit or preach on the streets. Whether you wake others up or not, ensure you yourself *never* fall asleep.
- difficulty: normal
- multiple: false
- starting tag: 
- doc elements: townstarting, postchristianity

### Faction: The Sanctuary
Esculap
intro: Above all, keep your Serpents in check.
- Above all, keep your Serpents in check. Otherwise, further science and treat the wounded.
- With science, the sky’s the limit. You can brew medicines and potions, install implants and body-modifications, and even experiment for the good of science.
- If there’s no wounded, get creative. Offer clinical trials; go foraging for unique ingredients and try to brew new potions; ask if the Incarn will let you experiment on his prisoners.
- You can perform medicine, removing negative medical tags according to their skill, Resource, and action cost. 
- difficulty: normal
- multiple: false
- starting tag: Medicine (Excellent)
- doc elements: townstarting, medicine

Serpent
intro: With science, the sky’s the limit.
- With science, the sky’s the limit. You can brew medicines and potions, install implants and body-modifications, and even experiment for the good of science.
- If there’s no wounded, get creative. Offer clinical trials; go foraging for unique ingredients and try to brew new potions; ask if the Incarn will let you experiment on his prisoners.
- You can perform medicine, removing negative medical tags according to their skill, Resource, and action cost. 
- difficulty: normal
- multiple: true
- starting tag: Medicine (Skilled)
- doc elements: townstarting, medicine

### Faction: Order of the Silver Cross (parent:The Church)
Inquisitor
intro: It is your everlasting duty to protect your people by expunging the barony’s corruption.
- Do you know what it means to love God?
- Dark days, exactly as preached in the scriptures, are coming to Ravenheart. Look at the people! They frolic, indulging themselves, like sheep before the slaughter! You have seen—*seen*—the blood, the horror. There are things that lurk in the shadows that no man could comprehend. But you have also seen the goodness of God.
- You are not thirsty for power. You are just sane. It is your everlasting duty to protect your people by expunging the barony’s corruption. To this end, organize your followers and, above all, work to radicalize the Town, the Church, and possibly even the Court.
- If you can get the Bishop on your side, it will be a great boon. He is weak! Force him to bend the knee.
- The time for silence has passed. There is no time to waste! Scream, from the top of your lungs, what is coming! Wake them!
- One other thing: the Incarn holds the Silver Cross, an artifact blessed to defeat evil. Secure it from him.
- difficulty: hard
- multiple: false
- starting tag: Leader
- doc elements: townstarting, postchristianity

Practicus
intro: Serve the Inquisitor, and work to radicalize the Town, the Church, and possibly even the Court.
- Do you know what it means to love God?
- Dark days, exactly as preached in the scriptures, are coming to Ravenheart. Look at the people! They frolic, indulging themselves, like sheep before the slaughter! You have seen—*seen*—the blood, the horror. There are things that lurk in the shadows that no man could comprehend. But you have also seen the goodness of God.
- You are not thirsty for power. You are just sane. It is your everlasting duty to protect your people by expunging the barony’s corruption. Work to radicalize the Town, the Church, and possibly even the Court.
- If you can get the Bishop on your side, it will be a great boon. He is weak! Force him to bend the knee.
- The time for silence has passed. There is no time to waste! Scream, from the top of your lungs, what is coming! Wake them!
- One other thing: the Incarn holds the Silver Cross, an artifact blessed to defeat evil. Secure it from him.
- difficulty: easy
- multiple: true
- starting tag: 
- doc elements: townstarting, postchristianity

Preacher
intro: You are the Order’s face. Speak in the Town Square for all to hear.
- You are the Order’s face. Speak in the Town Square for all to hear.
- Do you know what it means to love God?
- Dark days, exactly as preached in the scriptures, are coming to Ravenheart. Look at the people! They frolic, indulging themselves, like sheep before the slaughter! You have seen—*seen*—the blood, the horror. There are things that lurk in the shadows that no man could comprehend. But you have also seen the goodness of God.
- You are not thirsty for power. You are just sane. It is your everlasting duty to protect your people by expunging the barony’s corruption. To this end, organize your followers and, above all, work to radicalize the Town, the Church, and possibly even the Court.
- If you can get the Bishop on your side, it will be a great boon.
- The time for silence has passed. There is no time to waste! Scream, from the top of your lungs, what is coming! Wake them!
- One other thing: the Incarn holds the Silver Cross, an artifact blessed to defeat evil. Secure it from him.
- difficulty: easy
- multiple: true
- starting tag: 
- doc elements: townstarting, postchristianity

### Faction: The Town
Headman
intro: Ensure the Town works—and pays its taxes.
- On certain days, you hike up the mountain and behold the Town. Those are the people that are beholden to you. You cannot afford to let them down, Headman!
- Your main job is to ensure people are working and tax them. You are beholden to the Meister, the Baron’s taxman, and things have gotten nasty in the past when the tithe didn’t meet his expectations. He’ll take from the Silo; make sure it’s stocked.
- You informally lead the Town—everyone knows you and you know everyone. You can use a Move to decipher up to 3 random tags of anyone in the Town faction.
- On day one, figure out who should be on the Silo payroll—like the Sheriff—and who is capable of sustaining themselves.
- difficulty: normal
- multiple: false
- starting tag: Respected, Leader, Old, Farmer
- doc elements: townstarting, treasurer, farming

Sheriff
intro: Keep the peace in the Town, six-shooter at your hip.
- On certain days, you hike up the mountain and behold the Town. Those are the people that are beholden to you. You cannot afford to let them down, Sheriff!
- You have a trusty .45 six-shooter, a reject from the Fortress’s armory.
- difficulty: normal
- multiple: false
- starting tag: Fighter (Trained), Old .45 Revolver
- doc elements: townstarting

Metalsmith
intro: No one else can do it, Metalsmith.
- No one else can do it, Metalsmith. 
- With smithing, you are only limited by your Resources and your creativity. You can make weapons, but you can also make armor, tools, siege equipment, sculptures...
- Your intention is important. Swords might be useful in hand-to-hand combat,
- Simple things, like shortswords or basic tools, cost 1 Effort and 2 Resources. Moderately difficult things, like swords or breastplates, cost 1 Effort and 4 Resources. High quality things cost 2 Effort 
- difficulty: normal
- multiple: false
- starting tag: Hardy, Smithing
- doc elements: townstarting, smithing

Adventurer
intro: Sell your services. Delve into the Caves.
- Sell your services. Delve into the Caves.
- difficulty: normal
- multiple: true
- starting tag: 
- doc elements: townstarting

Merchant
intro: Make your fortune buying and selling Tags.
- Ravenheart is a great source of business and not much else. You wouldn’t dare put your heart here—the place is doomed. 
- Your goal is to make as many Resources as you can by buying and selling Tags. You have a Supply Depot in the caves: go there to request Tags by shuttle (it’ll cost you), and then sell them. To sell Tags, simply message a GM explaining who’d like the tag and how much you’re selling it for.
- If things ever get too dour, simply hop on your sponsor’s shuttle… if you can pay for it. Trip’s 30 Resources flat, pal.
- difficulty: hard
- multiple: false
- starting tag: 
- doc elements: townstarting, merchantlist

Docker
intro: Serve the Merchant and get drunk during the night.
- Serve the Merchant and get drunk during the night. Maybe he’ll let you get a ride on his spaceship if things ever get bad around here.
- difficulty: easy
- multiple: true
- starting tag: 
- doc elements: townstarting, merchantlist

Peasant
intro: You are a jobless peasant/
- You are a jobless peasant
- Do your job during the day, live a free life at night.
- difficulty: easy
- multiple: true
- starting tag: Hardy, +3 
- doc elements: townstarting

Peasant (Miller)
intro: Man the mill, turning Resources into more Resources.
- You are a jobless peasant
- Do your job during the day, live a free life at night.
- difficulty: easy
- multiple: false
- starting tag: Hardy, +3 
- doc elements: townstarting

Peasant (Farmer)
intro: Grow food during the day, live a free life at night.
- Grow food during the day, live a free life at night.
- difficulty: easy
- multiple: true
- parent role: Peasant
- starting tag: Hardy, Farmer
- doc elements: townstarting

Peasant (Fisher)
intro: Fish during the day, live a free life at night.
- Fish during the day, live a free life at night.
- Fishing is an Effort. It produces 
- difficulty: easy
- multiple: true
- parent role: Peasant
- starting tag: Hardy, Fisherman
- doc elements: townstarting

Peasant (Builder)
intro: Build and maintain during the day, live a free life at night.
- Build and maintain during the day, live a free life at night.
- difficulty: easy
- multiple: true
- parent role: Peasant
- starting tag: Hardy, Builder
- doc elements: townstarting

Herald
intro: Tell news, and take messages between the Village and the Fortress.
- Tell news, take messages between the Village and the Fortress, and buy a radio from the Merchant to make your job easier.
- difficulty: easy
- multiple: true
- starting tag: Well-Connected
- doc elements: townstarting

Outsider (Healer, Hunter)
intro: Live on the outskirts, forage herbs, and worship Sylva, god of Nature.
- Live on the outskirts, forage herbs, and worship Sylva, god of Nature.
- difficulty: easy
- multiple: true
- starting tag: Wild-Tuned
- doc elements: townstarting

Innkeeper (Innkeep, Cook, Brewer, Barmaid)
intro: Run the inn.
- Run the inn.
- difficulty: easy
- multiple: true
- starting tag: Hospitable
- doc elements: townstarting

Mortus
intro: Bury people and bring them to peace.
- Bury people and bring them to peace. Feed bums to the Lifeweb.
- difficulty: easy
- multiple: true
- starting tag: Unshaken
- doc elements: townstarting

Pusher
intro: Sell drugs.
- Sell drugs.
- difficulty: normal
- multiple: true
- starting tag: Discreet
- doc elements: townstarting

Bum
intro: You live in a shell and sleep with the dogs, but you understand life (or think you do).
- You live in a shell and sleep with the dogs, but you understand life (or think you do). Beg for food and coin.
- difficulty: easy
- multiple: true
- starting tag: Streetwise
- doc elements: townstarting

## Threats

Cult of Bacchus (Leader)
intro: Bacchus has willed you to take Ravenheart for them.
- Bacchus is the Lustful God, Creator of Illusions, the Eternal One. Bacchus is honest. Bacchus is life. Bacchus is pleasure. Bacchus is a zealot of hedonism. They rejoice over the fulfillment of desires and the euphoric suicide of their followers.
- Bacchus has willed you to take Ravenheart for them. 
- Bacchus is often depicted as an apple, a deer, or, in some circles, as a gigantic dead sea creature. Bacchus's gender is irrelevant. The specifics of doctrine are for you to figure out if you want.
- The stuck-ups in Ravenheart would kill you if they knew. Be careful.
- Followers of Bacchus gain +5 Tag Points per Desire instead of +3, but their Desires cannot be heroic or mild. They must, at least, be very indulgent. You also gain access to powerful Bacchus tags.
- Your goal is to spread the influence of Bacchus and throw parties. All cult members gain free Tags if you manage to host a party with 5, 10, or 15 people. People do not have to be part of the Cult to count towards the party number. Anyone with Royal Blood (Baron, Heir, Successor, Baroness, Bastard) counts as 3 people.
- There is a Succubus on the loose. She is an amazing asset, but she finds your ways too controlling. If you manage to bring her to the fold, she'll count as 3 people towards each party.
- Something very special happens if you host a party of 20 people. This is your ultimate goal. If the Succubus is present during the party, the surprise will be even better!
- You can either initiate people willingly or forcibly. Either way, you must perform a ritual that involves (1) either alcohol, music, lavish food, or drugs, and (2) secret chants in an ancient tongue. To initiate people against their will, lash them down and chant the rites—if they resist, it will be a Move.
- You can leave the Cult at any point, but you must confess everything you've ever done to a preacher, lose -10 Tag Points (yes, you can go into negative), and suffer through life-changing, excruciating withdrawal.
- starting tag: Follower of Bacchus, Leader
- doc elements: townstarting, cult

Cult of Bacchus (Cultist)
intro: You either love Bacchus and believe in their message, or love-hate them.
- Bacchus is the Lustful God, Creator of Illusions, the Eternal One. Bacchus is honest. Bacchus is life. Bacchus is pleasure. Bacchus is a zealot of hedonism. They rejoice over the fulfillment of desires and the euphoric suicide of their followers.
- You either love Bacchus and believe in their message, or love-hate them. Either way, you are certain you'll never leave.
- Bacchus is often depicted as an apple, a deer, or, in some circles, as a gigantic dead sea creature. Bacchus's gender is irrelevant. The specifics of doctrine are for you to figure out if you want.
- The stuck-ups in Ravenheart would kill you if they knew. Be careful.
- Followers of Bacchus gain +5 Tag Points per Desire instead of +3, but their Desires cannot be heroic or mild. They must, at least, be very indulgent. You also gain access to powerful Bacchus tags.
- You can either initiate people willingly or forcibly. Either way, you must perform a ritual that involves (1) either alcohol, music, lavish food, or drugs, and (2) secret chants in an ancient tongue.
- You can leave the Cult at any point, but you must confess everything you've ever done to a preacher, lose -10 Tag Points (yes, you can go into negative), and suffer through life-changing, excruciating withdrawal.
- starting tag: Follower of Bacchus
- doc elements: townstarting

The Judge (Town, or Cave)
intro: "Whatever in creation exists without my knowledge exists without my consent."
- "Whatever in creation exists without my knowledge exists without my consent." You start with +15 Tag Points.
- True evil doesn't exist, but you come close. Among the lost, weak, and misunderstood, history contains those who inexplicably choose darkness. That is you.
- Your ultimate goal is to become infamous—not because you care what other people think, but because it sends a message. The more people know, fear, or respect your name, the better.
- Immortal or delusional, you treat life like a game. You glory in war and despise weakness. You fear nothing, although people that are genuinely good through and through make you uncomfortable. Fortunately, there are very few of those left.
- You can work alone, but you are a natural leader. Take over the Brigands, start an adventurer troop, or rise the ranks of the Bastard's entourage.
- Do not hide your nature or commit murders in the dark. People can't help but love you.
- Your Desires must relate to violence, glory, control, or competition.
- starting tag: Infamous
- doc elements: townstarting

--------

# Camp
- Fed and united, the Bastard's troop is a powerful entourage, capable of taking on Ravenheart. But they suffer from supply problems and inner conflict. To fund the war campaign: raid the village (might make you unpopular), loot the caves (dangerous), establish a small farm, or send people into town to build a reputation.
- The camp is split. During a feud, a man from the Broken Spears Clan killed a Wheeler. Execute the killer, punish the Lieutenant, or compensate the Wheelers with Food, before it spirals out of your control.

## Roles

### Faction: The Bastard's Camp
Bastard (Windrider Clan)
intro: You've finally returned to your ancestral home.
- You've finally returned to your ancestral home. Unite your Lieutenants, feed your men, and take Ravenheart—it's your people's only hope.
- The Bastard and his men wear wind goggles and capes and generally aura farm. It's a wasteland out there. Most of your people are herders, healers, and engineers.
- difficulty: hard
- multiple: false
- starting tag: Royal Blood, Leader
- doc elements: campstarting

Camp Followers
intro: Tend wounds, keep the camp, keep the herds.
- Tend wounds, keep the camp, keep the herds.
- difficulty: easy
- multiple: true
- starting tag: Resilient
- doc elements: campstarting

Mother
intro: Counsel and support your son.
- Counsel and support your son, spy on the Lieutenants and ensure their loyalty. You would die for him.
- difficulty: normal
- multiple: false
- starting tag: Watchful
- doc elements: campstarting

Champion
intro: You taught the Bastard how to fight, how to sing, how to survive.
- You taught the Bastard how to fight, how to sing, how to survive. You will follow him to death.
- difficulty: normal
- multiple: false
- starting tag: Battle-Hardened
- doc elements: campstarting

Mentat
intro: The Bastard's right-hand man.
- The Bastard's right-hand man, in charge of ensuring—across clan lines—that there's enough Food and it's being equally split. He is the spymaster, the genius, the engineer, the calculator.
- difficulty: normal
- multiple: false
- starting tag: Sharp Mind
- doc elements: campstarting

Lieutenant (Broken Spears Clan)
intro: Your men are hungry. What is all this kingmaking business?
- Your men are hungry. What is all this kingmaking business? Just attack the fortress, raid the village! You trust the Bastard, but he doesn't act fast enough. Stimulant users.
- You are feuding with the Wheelers.
- Members: Fighter, Fighter (Builder), Fighter (Standard Bearer), Fighter (Etc.), Camp Follower.
- difficulty: normal
- multiple: false
- starting tag: Stimulant User, Leader
- doc elements: campstarting

Lieutenant (Six-Spoke Wheel Clan)
intro: Famed for their mastery over the revolver.
- Famed for their mastery over the revolver. The Six-Spoke Wheel Clan are ancient herders and lawkeepers—the old guard. Defend your honor. You trust the Bastard, but he doesn't respect the old ways enough.
- You are feuding with the Broken Spears.
- Members: Fighter, Fighter (Tinker), Fighter (Standard Bearer), etc., Camp Follower.
- difficulty: normal
- multiple: false
- starting tag: Old Guard, Leader
- doc elements: campstarting

Lieutenant (Windrider Clan)
intro: All you want is a home for your people.
- All you want is a home for your people, and the Bastard can provide you that. You're fully loyal to him.
- difficulty: normal
- multiple: false
- starting tag: Loyal, Leader
- doc elements: campstarting

## Threats

Brigand Leader
intro: You raided a shipment on the way to the Fortress—well done!
- You raided a shipment on the way to the Fortress—well done! You have plenty of Food, now.
- starting tag: Opportunist, Leader
- doc elements: campstarting

Brigand
intro: You raided a shipment on the way to the Fortress—well done!
- You raided a shipment on the way to the Fortress—well done! You have plenty of Food, now.
- starting tag: Opportunist
- doc elements: campstarting

--------

# Caves
- The Caves: Migrants make it to the Fortress from here.

## Roles

### Faction: Caves
Migrant
intro: Make it to the fortress.
- Make it to the fortress.
- difficulty: easy
- multiple: true
- starting tag: Determined
- doc elements:

Mercenary
intro: Delve into the Caves for pay.
- Delve into the Caves for pay.
- difficulty: normal
- multiple: true
- starting tag: Battle-Hardened
- doc elements:

Miner
intro: Work the Caves.
- Work the Caves.
- difficulty: easy
- multiple: true
- starting tag: Sturdy
- doc elements:

## Threats

Monsters (NPC)
intro: Monsters in the caves, to be hunted.
- Monsters in the caves, to be hunted.
- starting tag:
- doc elements:

Brigand Leader (Caves)
intro: Loot the caves (dangerous) as a way to fund the Camp's war effort.
- Loot the caves (dangerous) as a way to fund the Camp's war effort.
- starting tag: Opportunist, Leader
- doc elements:

Brigand (Caves)
intro: Loot the caves (dangerous) as a way to fund the Camp's war effort.
- Loot the caves (dangerous) as a way to fund the Camp's war effort.
- starting tag: Opportunist
- doc elements:

--------

# Documents
Explanation:
- tag: Anyone with this tag gets this Document.
- public: If assigned, this will appear in a player’s document folder. However, using the search function, anyone can browse and find this document.

Courtier
As a member of the Baron’s retinue, you may take food from the faction Silo whenever you please—within reason (Treasurer roles can see their Silo’s transaction history, so don’t steal. If you’d like to steal, arrange it with a GM)

Diplomat
You are from the Culture, a post-scarcity interstellar empire ruled by benevolent robots. You want the best for the people of Ravenheart—and that would mean convincing the Baron to join the Culture—but Contact (the Culture's diplomatic wing) operates in the scale of centuries, not human generations. They don't think it's the right time. Therefore, do the best you can to quietly help people and further the Culture's mission: install an open-minded ruler, ensure the Order of the Iron Cross doesn't grow out of control, and above all, do not blow your cover. You have limited gadgets—including an autonomous, sentient drone disguised as a raven. If anything goes wrong, the "Helpless Is The Face Of Your Beauty" will teleport you on board. It'll take your message three minutes to reach them.

Guard

The Watch is Ravenheart’s primary fighting force, tasked with defending the Fortress but occasionally—if the Baron wills it—venturing forth to protect the Town.

The Watch is commanded by the Captain.

Treasurer 
- public: yes
- tag: treasurer, Leader


Medical:

- synced list of medical tags, hover

Combat
Where to Aim
- Hard to hit, but rewarding: Head, Eyes, Neck.
- Trickier: Hands, Feet, Groin, Face.
- Easy, but least effective: Body.

Aim for what's unprotected—armor has gaps and joints, and a shorter weapon finds them more easily than a long one. Any wound saps the target's coordination for a few seconds, so it's often worth softening someone up before going for a finishing blow. A downed opponent is far easier to finish off than one still on their feet.

Weapons
- Blunt (clubs, staves, fists) — the most versatile option, but rarely puts someone down for good on its own.
- Stabbing (spears, rapiers, daggers) — precise, and effective against unarmored targets.
- Penetrating (picks) — brutal, but prone to getting stuck in whatever it hits.
- Cutting (swords, knives) — even light armor blunts a cutting weapon's edge.
- Slashing (axes) — good at cutting through shields.

Armor
- Plate and other rigid, single-piece armor reliably turns aside blows, but has joints and gaps a determined attacker can exploit.
- Chainmail and other soft armor stops a blade, but a blunt weapon can still bruise or break bone underneath.
- Quilted armor (gambesons and the like) softens blunt impacts further, and layers well under other armor—chainmail can even go under formal court dress.
- Almost nothing stops a bullet.
- Wear a helmet. A solid hit to the head changes everything.

Shields
- A shield is a serious advantage in melee—something to hide behind, and something to hit with.
- Fighters standing shield-to-shield are safer together than apart.

Energy Shields
Rare and expensive personal-scale energy shields exist in the wasteland around Ravenheart, remnants of finer technology than the barony can produce itself.
- Stop bullets, arrows, and energy blasts outright.
- Reduce, but don't stop, melee damage.
- Do nothing against needles or syringes.
- Worn on the belt or the wrist.
- Short out on contact with liquid.
- Two shields, held close together, can be turned into a weapon of their own.

- public: yes