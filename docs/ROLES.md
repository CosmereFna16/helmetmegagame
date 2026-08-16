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

---

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
- doc elements: courtstructure, lifewebbasic, fortressstarting, armory, ravenhearteconomy

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
- doc elements: courtstructure, lifewebbasic, fortressstarting, courtier, armory, ravenhearteconomy

Meister
intro: You are the Keep’s brains, but more importantly, its circulatory system.

- You are the Keep’s brains, but more importantly, its circulatory system. Ensure the Town sends its taxes—your main contact there is the Headman—and oversee that no one is taking undue amounts of Resources from the Silo.
- Consider keeping records of what happens every day. They may be useful later.
- You have minor medical training and you know how to use the Keep’s messenger ravens.
- difficulty: normal
- multiple: false
- starting tag: Intelligent, Frail, Treasurer, Medical (Skilled), Ravenkeeper
- doc elements: courtstructure, lifewebbasic, fortressstarting, courtier, ravens, medical, ravenhearteconomy

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
- starting tag: Fighting (Skilled), Arthritis, Old, Armor
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
- doc elements: courtier, courtstructure, fortressstarting

Servant (Chef)
intro: Prepare meals for the household and keep the kitchens running.

- Prepare meals for the household and keep the kitchens running.
- difficulty: easy
- multiple: true
- parent role: Servant
- starting tag: Cooking (Skilled)
- doc elements: courtier, fortressstarting, courtstructure

### Faction: The Watch

parent:The Court

Captain
intro: Bravely lead the Watch and hold back the darkness, you goddamn hero.

- Bravely lead the watch and hold back the darkness, you goddamn hero.
- difficulty: hard
- multiple: false
- starting tag: Fighting (Trained), Treasurer, Leader
- doc elements: courtstructure, fortressstarting, guard, armory, combat

Incarn
intro: You are a warrior monk, dedicated to serving Ravenheart.

- You are a warrior monk and you serve Ravenheart. You love goodness and hate evil.
- Your job is to guard the dungeon, process migrants, and protect the Silver Cross, Ravenheart's only relic. The Silver Cross is an ancient artifact. It terrifies and burns demonic creatures.
- difficulty: normal
- multiple: false
- starting tag: Fighting (Skilled), Treasurer
- doc elements: courtstructure, fortressstarting, guard, postchristianity, armory, combat

Guard
intro: Serve the Baron, salute your Captain, and hold back the tide of darkness.

- Serve the Baron, salute your Captain, and hold back the tide of darkness.
- difficulty: easy
- multiple: true
- starting tag: Fighting (Trained)
- doc elements: courtstructure, fortressstarting, guard, armory, combat

Squire
intro: Train. One day, you might become a knight.

- Train. One day, you might become a knight.
- difficulty: easy
- multiple: true
- starting tag: Fighting (Basic)
- doc elements: courtstructure, fortressstarting, guard, armory, combat

## Threats

Sympathizer (Fortress)
intro: Install the Bastard on the throne, by any means necessary.

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

---

# Town

- The last tithe wagon didn't return from the Fortress—it was probably ambushed by bandits. The Meister won't be happy about this. Prepare to have the Silo drained.
- Last week, Thomas Ciobanu—a respectable tradesman—was found milky-eyed, giggly, with a profoundly satisfied look. He wandered around aimlessly, going hungry—when people tried to help him, he just called them fools. The Esculap's medicine couldn't do anything for him, so the Inquisitor had him hanged. He fought all the way to the gallows, like a rabid dog.

## Roles

### Faction: The Church

Bishop
intro: Lead the Church, and be a shining example of goodness in dark days.

- It is not the first time dark days have come to Ravenheart, but they are difficult times still. You hope the people will survive—God will ensure it. During this difficult transition, ensure you serve as a shining example of goodness.
- At some point, you will have to decide between peacefulness or the Order of the Silver Cross.
- Along with the Priest, you have the power to dispel negative Tags of the psychological kind—the person must first confess to you, then spend a whole day in prayer (2 Efforts).
- difficulty: normal
- multiple: false
- starting tag: Priest, Leader, Pious
- doc elements: townstarting, postchristianity, church, ravenhearteconomy

Priest
intro: Care for the needy, lend an ear, and kindle goodness in others.

- It is not the first time dark days have come to Ravenheart. The people will survive—God will ensure it. During this difficult transition, ensure you serve as a shining example of goodness. Evil can only be held back with Truth—do not stoop to violence or zealotry.
- Care for the needy, lend an ear, and kindle goodness in others. Pay visits to the Fortress. Practice pacifism or support the Inquisition.
- Along with the Bishop, you have the power to dispel negative Tags of the psychological kind—the person must first confess to you, then spend a whole day in prayer (2 Efforts).
- difficulty: easy
- multiple: true
- starting tag: Priest, Pious
- doc elements: townstarting, postchristianity, church

Priest (Nun)
intro: Care for the needy, lend an ear, and kindle goodness in others.

- It is not the first time dark days have come to Ravenheart. The people will survive—God will ensure it. During this difficult transition, ensure you serve as a shining example of goodness. Evil can only be held back with Truth—do not stoop to violence or zealotry.
- Care for the needy, lend an ear, and kindle goodness in others. Pay visits to the Fortress. Practice pacifism or support the Inquisition.
- Along with the Bishop, you have the power to dispel negative Tags of the psychological kind—the person must first confess to you, then spend a whole day in prayer (2 Efforts).
- difficulty: easy
- multiple: true
- parent role: Priest
- starting tag: Priest, Pious
- doc elements: townstarting, postchristianity, church

Scholastic
intro: Search for knowledge—occult or otherwise—and write your magnum opus.

- Earth is a speck in the infinite firmament. You have always been humbled—or perhaps energized—by the Truth. Try to understand it. Search for knowledge—occult or otherwise—and write your magnum opus. Be a hermit or preach on the streets. Whether you wake others up or not, ensure you yourself _never_ fall asleep.
- difficulty: normal
- multiple: false
- starting tag:
- doc elements: townstarting, postchristianity, church

### Faction: The Sanctuary

Esculap
intro: Above all, keep your Serpents in check.

- Above all, keep your Serpents in check. Otherwise, further science and treat the wounded.
- With science, the sky’s the limit. You can brew medicines and potions, install implants and body-modifications, and even experiment for the good of science.
- If there’s no wounded, get creative. Offer clinical trials; go foraging for unique ingredients and try to brew new potions; ask if the Incarn will let you experiment on his prisoners.
- You can perform medicine, removing negative medical tags according to their skill, Resource, and action cost.
- difficulty: normal
- multiple: false
- starting tag: Medical (Excellent), Brewing (Skilled)
- doc elements: townstarting, medical

Serpent
intro: With science, the sky’s the limit.

- With science, the sky’s the limit. You can brew medicines and potions, install implants and body-modifications, and even experiment for the good of science.
- If there’s no wounded, get creative. Offer clinical trials; go foraging for unique ingredients and try to brew new potions; ask if the Incarn will let you experiment on his prisoners.
- You can perform medicine, removing negative medical tags according to their skill, Resource, and action cost.
- difficulty: normal
- multiple: true
- starting tag: Medical (Skilled), Brewing (Skilled)
- doc elements: townstarting, medical

### Faction: Order of the Silver Cross (parent:The Church)

Inquisitor
intro: It is your everlasting duty to protect your people by expunging the barony’s corruption.

- Do you know what it means to love God?
- Dark days, exactly as preached in the scriptures, are coming to Ravenheart. Look at the people! They frolic, indulging themselves, like sheep before the slaughter! You have seen—_seen_—the blood, the horror. There are things that lurk in the shadows that no man could comprehend. But you have also seen the goodness of God.
- You are not thirsty for power. You are just sane. It is your everlasting duty to protect your people by expunging the barony’s corruption. To this end, organize your followers and, above all, work to radicalize the Town, the Church, and possibly even the Court.
- If you can get the Bishop on your side, it will be a great boon. He is weak! Force him to bend the knee.
- The time for silence has passed. There is no time to waste! Scream, from the top of your lungs, what is coming! Wake them!
- One other thing: the Incarn holds the Silver Cross, an artifact blessed to defeat evil. Secure it from him.
- difficulty: hard
- multiple: false
- starting tag: Leader, Pious
- doc elements: townstarting, postchristianity, church

Practicus
intro: Serve the Inquisitor, and work to radicalize the Town, the Church, and possibly even the Court.

- Do you know what it means to love God?
- Dark days, exactly as preached in the scriptures, are coming to Ravenheart. Look at the people! They frolic, indulging themselves, like sheep before the slaughter! You have seen—_seen_—the blood, the horror. There are things that lurk in the shadows that no man could comprehend. But you have also seen the goodness of God.
- You are not thirsty for power. You are just sane. It is your everlasting duty to protect your people by expunging the barony’s corruption. Work to radicalize the Town, the Church, and possibly even the Court.
- If you can get the Bishop on your side, it will be a great boon. He is weak! Force him to bend the knee.
- The time for silence has passed. There is no time to waste! Scream, from the top of your lungs, what is coming! Wake them!
- One other thing: the Incarn holds the Silver Cross, an artifact blessed to defeat evil. Secure it from him.
- difficulty: easy
- multiple: true
- starting tag: Pious
- doc elements: townstarting, postchristianity, church

Preacher
intro: You are the Order’s face. Speak in the Town Square for all to hear.

- You are the Order’s face. Speak in the Town Square for all to hear.
- Do you know what it means to love God?
- Dark days, exactly as preached in the scriptures, are coming to Ravenheart. Look at the people! They frolic, indulging themselves, like sheep before the slaughter! You have seen—_seen_—the blood, the horror. There are things that lurk in the shadows that no man could comprehend. But you have also seen the goodness of God.
- You are not thirsty for power. You are just sane. It is your everlasting duty to protect your people by expunging the barony’s corruption. To this end, organize your followers and, above all, work to radicalize the Town, the Church, and possibly even the Court.
- If you can get the Bishop on your side, it will be a great boon.
- The time for silence has passed. There is no time to waste! Scream, from the top of your lungs, what is coming! Wake them!
- One other thing: the Incarn holds the Silver Cross, an artifact blessed to defeat evil. Secure it from him.
- difficulty: easy
- multiple: true
- starting tag: Pious
- doc elements: townstarting, postchristianity, church

### Faction: The Town

Headman
intro: Lead the Town. Ensure it works and pays its taxes.

- On certain days, you hike up the mountain and behold the Town. Those are the people that are beholden to you. You cannot afford to let them down, Headman!
- Your main job is to tax people. You are beholden to the Meister, the Baron’s taxman, and things have gotten nasty in the past when the tithe didn’t meet his expectations. If the Silo’s not full next time he comes, it won’t be a pretty day.
- You also owe some tax to the Bishop.
- The Sheriff is on your payroll.
- You informally lead the Town—everyone knows you and you know everyone. You can use a Move to decipher up to 3 random tags of anyone in the Town faction.
- difficulty: hard
- multiple: false
- starting tag: Respected, Leader, Old, Farmer
- doc elements: townstarting, farming, ravenhearteconomy

Sheriff
intro: Keep the peace in the Town, six-shooter at your hip.

- On certain days, you hike up the mountain and behold the Town. Those are the people that are beholden to you. You cannot afford to let them down, Sheriff!
- You have a trusty .45 six-shooter, a reject from the Fortress’s armory.
- difficulty: normal
- multiple: false
- starting tag: Fighting (Trained), Old .45 Revolver
- doc elements: townstarting, combat

Metalsmith
intro: Forge anything from basic tools to siege implements and legendary weapons.

- With smithing, you are only limited by your Resources and your creativity. You can make weapons, but you can also make armor, tools, siege equipment, sculptures...
- You’re not on the Headman’s payroll, so it’s important you find clients so that you can feed yourself.
- The theory is important. Axes are good at breaking shields; blunt weapons harm people even in full armor; swords excel in one-to-one combat.
- Simple things, like shortswords or basic tools, cost 1 Effort and 2 Resources. Moderately difficult things, like swords or breastplates, cost 1 Effort and 4 Resources. High quality objects cost 2 Efforts and 6 Resources.
- You can also make Unique Tags—name and describe them—for 2 Efforts, 1 Move, and 12 Resources. You’ll have to roll to see what the quality ends up being.
- difficulty: normal
- multiple: true
- starting tag: Smithing
- doc elements: townstarting, smithinglist, combat, independent

Peasant
intro: You’re a peasant without a job, but luck is on your side (+4 starting Tag Points).

- Find a job, pay your taxes, and feed yourself. Live a free life at night.
- difficulty: easy
- multiple: true
- starting tag:
- starting points: +4
- doc elements: townstarting, production, independent

Peasant (Farmer)
intro: Grow food during the day, live a free life at night.

- Grow food during the day, live a free life at night.
- You pay taxes. Spend your Resources lightly!
- difficulty: easy
- multiple: true
- parent role: Peasant
- starting tag: Farmer
- doc elements: townstarting, production, independent

Peasant (Fisher)
intro: Fish during the day, live a free life at night.

- Fish during the day, live a free life at night.
- You have a boat.
- You pay taxes. Spend your Resources lightly!
- difficulty: easy
- multiple: true
- parent role: Peasant
- starting tag: Fisherman, Boat
- doc elements: townstarting, production, independent

Herald
intro: Tell the news, take messages, and hope either the Baron or the Headman will pay you.

- Done rightly, your job can be quite profitable—particularly if you're willing to spy and play the information game.
- Many people are willing to divulge their secrets. Lend an ear, and you'll be surprised at what you pick up.
- Since it takes 1 Turn to travel between Zones—and most people aren't making the trip back and forth anyways—information's not instant. The Baron, the Headman, or even the Hand might like to know what's happening on the other side of Ravenheart.
- difficulty: easy
- multiple: false
- starting tag:
- doc elements: townstarting, independent

Outsider
intro: Live on the outskirts and worship Sylva, god of Nature.

- Live on the outskirts and worship Sylva, god of Nature.
- difficulty: easy
- multiple: true
- starting tag: Forester
- doc elements: townstarting, production, independent

Outsider (Healer)
intro: Forage herbs on the outskirts and tend to the sick and wounded.

- Forage herbs on the outskirts and tend to the sick and wounded.
- difficulty: easy
- multiple: true
- parent role: Outsider
- starting tag: Medical (Basic), Brewing (Basic), Forester
- doc elements: townstarting, production, medical, independent

Outsider (Hunter)
intro: Track game through the wilds and bring back meat for the Town.

- Track game through the wilds and bring back meat for the Town.
- In #turns, you can roll for a hunt instead of stating a flat Resource amount — add something like +1d6\*2 to your message and it'll be rolled once you confirm.
- difficulty: easy
- multiple: true
- parent role: Outsider
- starting tag: Hunter, Forester
- doc elements: townstarting, production, independent

Mortus
intro: Bring spirits to peace and feed the Lifeweb.

- You have two jobs, both of them sacred: 1. feed the Lifeweb and 2. bury people, bringing their souls to peace.
- The Mortii take a vow, dedicating themselves to powering the Lifeweb. They are often exiles, outcasts, or infirms. Why did you take the vow?
- The Lifeweb maintains Ravenheart's environment. Without it, it'll fade into the wastelands. However, it is powered by human blood. People can either voluntarily donate their blood to feed it for a short time—or you can kidnap people and feed them manually
- Any crimes you commit in service of your vow are not crimes.
- You are allowed to loot whatever corpses you find. That's how the Mortus traditionally sustain themselves, but if dead people are scarce, you can ask the Headman for some food.
- difficulty: easy
- multiple: true
- starting tag: Mortus
- doc elements: townstarting, lifeweb, respawning

Pusher
intro: Sell drugs.

- Sell drugs.
- difficulty: normal
- multiple: true
- starting tag: Discreet
- doc elements: townstarting, alcoholdrugs, independent

Bum
intro: You live in a shell and sleep with the dogs, but you understand life (or think you do).

- You live in a shell and sleep with the dogs, but you understand life (or think you do). Beg for food and coin.
- difficulty: easy
- multiple: true
- starting tag: Streetwise
- doc elements: townstarting

### Faction: The Inn

parent:The Town

Innkeeper
intro: Name and run the inn: set prices, hire and fire staff, and run an actual, living business.

- The inn is a game of its own. It's up to you to figure out how to make a living out of it. For one thing, you can consider asking the Merchant for a loan.
- Cook fine meals, brew alcohol, hire bards and pretty ladies—keep the Customer coming back, yes—but be creative. Running an information network or turning the Inn into a place for people to find jobs are examples of the creative ways you can take advantage of owning Ravenheart's most popular enterprise.
- You are responsible for paying your staff. They have to eat.
- difficulty: normal
- multiple: false
- starting tag: Leader, Cooking (Basic), Brewing (Basic)
- doc elements: townstarting, alcoholdrugs, meals, inn

Cook
intro: Cook lavish meals for inn patrons.

- You're a skilled cook and can spend Resources to make refined meals that make people happy.
- difficulty: easy
- multiple: true
- parent role: Innkeeper
- starting tag: Cooking (Skilled)
- doc elements: townstarting, meals, bar, inn

Brewer
intro: Brew alcohol and tonics for the inn, or split off and start your own enterprise.

- You're a skilled brewer and can brew refined forms of alcohol to make customers happy.
- difficulty: easy
- multiple: false
- parent role: Innkeeper
- starting tag: Brewing (Skilled)
- doc elements: townstarting, alcoholdrugs, inn, independent

Innkeeper (Barmaid)
intro: Serve drinks and keep the room talking.

- Serve drinks and keep the room talking.
- difficulty: easy
- multiple: true
- parent role: Innkeeper
- starting tag:
- doc elements: townstarting, alcoholdrugs, meals, inn, independent

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

---

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

---

# Caves

- The Caves: Migrants make it to the Fortress from here.

## Roles

### Faction: Unaffiliated

Merchant
intro: Make your fortune buying and selling Tags.

- Ravenheart is a great source of business and not much else. You wouldn’t dare put your heart here—the place is doomed.
- Your goal is to make as many Resources as you can by buying and selling Tags. You have a Supply Depot in the caves: go there to request Tags by shuttle (it’ll cost you), and then sell them. To sell Tags, simply message a GM explaining who’d like the tag and how much you’re selling it for.
- Try your hand at usury. Lend loans with interest, and call on your Dockers to enforce them. That's probably the easiest way to make serious bucks.
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
