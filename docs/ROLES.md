Master formatting:

# {Zone}
Situation rundown

## Roles

### Faction: {Faction}
- Summary point 1...
- Summary point 2...
- difficulty: {hard, normal, easy}
- leader: true/false
- starting tag: tag, tag
- doc elements: {element (ex:courtstructure)}, {element}, {element}

## Threats

--------

# Fortress
- The last tithe didn't arrive, and it shows. The banquets are a little less extravagant than usual. Pressure builds on the Meister—go talk to the Headman. Take whatever they can spare from their stores.
- A letter from the Bastard declaring his intents was found on the table. Since the Guards didn't see anyone come in, it's clear someone on the inside brought it in. There must be a traitor.
- To lift spirits, the Baron has offered the Successor's (or Heir's) hand in marriage. The Courtiers, suspecting each other to be traitors, rival for the betrothal.

## Roles

### Faction: Court
Baron
- You are the ruler. Protect your dynasty, and optionally your people. Find a balance between staying happy and alive.
- Your offices have a PA system that can be heard in intercoms throughout Ravenheart.
- Above all, be proactive. Ravenheart is a dangerous place. If you prepare well, you may keep the throne.
- difficulty: hard
- leader: true
- tag: leader
- multiple: false
- starting tag: Royal Blood, Leader, Treasurer
- doc elements: courtstructure, lifewebbasic, fortressstarting

Baroness
- Take care of your children. Be the Lioness, or succumb to anxiety.
- difficulty: easy
- leader: false
- multiple: false
- starting tag: Royal Blood
- doc elements: courtstructure, lifewebbasic, fortressstarting

Heir
- You are your father’s son. Are you the exact opposite of him, or his closest ally?
- difficulty: easy
- leader: false
- multiple: false
- starting tag: Royal Blood
- doc elements: courtstructure, lifewebbasic, fortressstarting

Successor
- You are the Baron’s daughter. Bring some light to the darkness.
- difficulty: easy
- leader: false
- multiple: false
- starting tag: Royal Blood
- doc elements: courtstructure, lifewebbasic, fortressstarting

Hand
- You’re the Baron’s best friend and perhaps the only man he can truly trust. You are completely loyal to him.
- The Baron works best when he’s informed and has a court that’s loyal and organized. You are his spymaster, his executor, his voice. Without you, Ravenheart collapses.
- Above all, be proactive. Ravenheart is a dangerous place. If you prepare well, the Baron may keep the throne. If you don’t, it won’t be long until someone kills him or makes a fool out of him.
- difficulty: normal
- leader: false
- multiple: false
- starting tag: Treasurer
- doc elements: courtstructure, lifewebbasic, fortressstarting, courtier

Meister
- You are the Keep’s brains, but more importantly, its circulatory system. Ensure the Town sends its taxes—your main contact there is the Headman—and oversee that no one is taking undue amounts of Resources from the Silo.
- Consider keeping records of what happens every day. They may be useful later.
- You have minor medical training and you know how to use the Keep’s messenger ravens. 
- difficulty: normal
- leader: false
- multiple: false
- starting tag: Intelligent, Frail, Treasurer, Medical (1), Ravenkeeper
- doc elements:courtstructure, lifewebbasic, fortressstartingtithe, fortressstartingletter, courtier, ravens

Courtier
- For whatever reason, the Baron keeps you around in his court. Convince the Captain to launch an expedition into the caves, host marvelous feasts, and duel your fellow courtiers for the Successor’s affection.
- difficulty: easy
- leader: false
- multiple: true
- starting tag: 
- doc elements: courtier

Courtier (Manor Lord)
- Live in your manor, enjoy your wine, and participate in court politics.
- difficulty: easy
- leader: false
- multiple: true
- parent role: Courtier
- starting tag: Manor
- doc elements: courtier

Courtier (Manor Lady)
- Support your husband and maintain your manor.
- difficulty: easy
- leader: false
- multiple: true
- parent role: Courtier
- starting tag: Manor
- doc elements: courtier

Courtier (Minstrel)
- Compose ballads, smuggle drugs from the town (and peddle them to the courtiers), keep the Baron happy.
- difficulty: easy
- leader: false
- multiple: true
- parent role: Courtier
- starting tag: Musician
- doc elements: courtier

Courtier (Old Knight)
- Reminisce about your valiant service against the Cult of Kosm in 1025. Polish your zweihander, take potions for your arthritis, and serve the Baron.
- difficulty: easy
- leader: false
- multiple: true
- parent role: Courtier
- starting tag: Fighter (Sword), Arthritis, Armored
- doc elements: courtier

Courtier (Diplomat)
- Recover ancient artifacts and study Ravenheartian culture. Meddle. Convince the Baron to join your interstellar federation. Be a scapegoat.
- difficulty: easy
- leader: false
- multiple: true
- parent role: Courtier
- starting tag: 
- doc elements: courtier, diplomat

Servant
- Keep the fortress running. Clean, cook, maintain, and serve.
- difficulty: easy
- leader: false
- multiple: true
- starting tag: 
- doc elements: courtier

Servant (Chef)
- Prepare meals for the household and keep the kitchens running.
- difficulty: easy
- leader: false
- multiple: true
- parent role: Servant
- starting tag: Cook (1), Cook (2)
- doc elements: courtier


### Faction: Fortress Guard
Captain
- Bravely lead the Guard. Battle your alcoholism.
- difficulty: normal
- leader: true
- tag: leader
- multiple: false
- starting tag: Alcoholic
- doc elements:

Incarn
- You are a warrior monk. Guard the dungeon, process migrants, and guard the Silver Cross, Ravenheart's only relic.
- difficulty: normal
- leader: false
- multiple: true
- starting tag: 
- doc elements:

Guard
- Do what you are told to do.
- difficulty: easy
- leader: false
- multiple: true
- starting tag: 
- doc elements:

Squire
- Train.
- difficulty: easy
- leader: false
- multiple: true
- starting tag: 
- doc elements:

## Threats

Sympathizer (Fortress)
- Your main goal: install the Bastard on the throne. To that end, turn the court against itself, scheme, and so on.
- You must also choose a second, self-serving goal. Ideas: kill the Baron in a dramatic way as revenge; kidnap the Heir or Successor (you're obsessed); take the Manor from the Lord and install yourself in it. In other words, figure out why you are personally invested in seeing this through.
- Be creative. Turn people against each other, convert people, cause incidents that make other people look bad. 
- difficulty: hard
- leader: false
- multiple: true
- starting tag: 
- doc elements:

Succubus (Fortress)
- You don't need to eat. Instead, you live for the thrill of enslaving souls and causing pain, and will become depressed if you don't. You gain Tag Points by enslaving souls.
- When you enslave a soul, that person has to follow your commands. You can only control up to two people at a time.
- You find normal crosses tacky and boring. Fire scares you somewhat—it definitely hurts. However, the Silver Cross terrifies you and burns you on touch.
- The Cult of Bacchus is active in the area. They'd love to have you at their parties, and may be tracking you down. Flee! They'll take your treasured independence.
- Choose your true form from the following: Satyr, Serpent, or Siren.
- You gain Tag Points by sleeping with people (+7), but you can also entertain yourself by capturing and torturing people (+4). You also gain points by making someone obsessed with you, either through romance, jealousy, or anger (+4).
- difficulty: hard
- leader: false
- multiple: false
- starting tag: 
- doc elements:

--------

# Town
- The last tithe wagon didn't return from the Fortress—it was probably ambushed by bandits. The Meister won't be happy about this. Prepare to have the Silo drained.
- The Succubus takes souls while the Cult of Bacchus hosts ribald gatherings. The Church, followers of God, is split as the Order of the Silver Cross grows in power.
- The Inquisitor has planned an execution with the sheriff's permission. The Cult of Bacchus wants to break him out.

## Roles

### Faction: Church
Bishop
- Encourage people to lead pious lives! Speak the healing word of God, or side with the Inquisition.
- Along with the Priest, you have the power to dispel negative Tags of the psychological kind—the person must first confess to you, then spend a whole day in prayer (2 Efforts) and resolve to do better.
- difficulty: normal
- leader: true
- tag: leader
- multiple: false
- starting tag: Pious
- doc elements: townstarting

Priest / Nun
- Care for the needy, lend an ear, and kindle goodness in others. Pay visits to the Fortress. Practice pacifism or support the Inquisition.
- difficulty: easy
- leader: false
- multiple: true
- starting tag: Compassionate
- doc elements: townstarting

Scholastic
- Try to understand the cosmos. Collect enough occult information to write your magnum opus. Be a hermit or preach on the streets. Burn at the stake.
- difficulty: normal
- leader: false
- multiple: true
- starting tag: Inquisitive
- doc elements: townstarting

### Faction: The Sanctuary
Esculap
- Keep your Serpents in check.
- difficulty: normal
- leader: true
- tag: leader
- multiple: false
- starting tag: Steady Hands
- doc elements: townstarting

Serpent
- Perform surgeries, brew medicines, prescribe drugs, install implants and body-modifications, and experiment for the good of science. The more you can learn and experiment, the better at medicine you'll be.
- difficulty: normal
- leader: false
- multiple: true
- starting tag: Steady Hands
- doc elements: townstarting

### Faction: Order of the Silver Cross
Inquisitor
- Radicalize the Village and the Church, convince the Incarn to hand over the Silver Cross, and obtain ultimate purity. Ask the Scholastic what he's writing.
- difficulty: hard
- leader: true
- tag: leader
- multiple: false
- starting tag: Zealous
- doc elements: townstarting

Practicus
- Serve the Inquisitor. Preach on the street and rile the people up.
- difficulty: normal
- leader: false
- multiple: true
- starting tag: Zealous
- doc elements: townstarting

Zealot
- Preach.
- difficulty: easy
- leader: false
- multiple: true
- starting tag: Zealous
- doc elements: townstarting

### Faction: The People (Village)
Headman
- Mayor-ish. Can use a Move to learn up to 2 of a Village character's Tags. Pay the people on your payroll (Sheriff, etc.).
- difficulty: normal
- leader: true
- tag: leader
- multiple: false
- starting tag: Respected
- doc elements: townstarting

Sheriff
- Out of these five people, you know one of them is involved with something.
- difficulty: normal
- leader: false
- multiple: false
- starting tag: Watchful
- doc elements: townstarting

Adventurer
- Sell your services. Delve into the Caves.
- difficulty: normal
- leader: false
- multiple: true
- starting tag: Reckless
- doc elements: townstarting

Merchant
- Sells Tags, gives loans.
- difficulty: easy
- leader: false
- multiple: true
- starting tag: Shrewd
- doc elements: townstarting

Peasant (Farmer, Fisher, Builder)
- Grow food during the day, live a free life at night.
- difficulty: easy
- leader: false
- multiple: true
- starting tag: Hardy
- doc elements: townstarting

Herald
- Tell news, take messages between the Village and the Fortress, and buy a radio from the Merchant to make your job easier.
- difficulty: easy
- leader: false
- multiple: true
- starting tag: Well-Connected
- doc elements: townstarting

Outsider (Healer, Hunter)
- Live on the outskirts, forage herbs, and worship Sylva, god of Nature.
- difficulty: easy
- leader: false
- multiple: true
- starting tag: Wild-Tuned
- doc elements: townstarting

Innkeeper (Innkeep, Cook, Brewer, Barmaid)
- Run the inn.
- difficulty: easy
- leader: false
- multiple: true
- starting tag: Hospitable
- doc elements: townstarting

Mortus
- Bury people and bring them to peace. Feed bums to the Lifeweb.
- difficulty: easy
- leader: false
- multiple: true
- starting tag: Unshaken
- doc elements: townstarting

Pusher
- Sell drugs.
- difficulty: normal
- leader: false
- multiple: true
- starting tag: Discreet
- doc elements: townstarting

Bum
- You live in a shell and sleep with the dogs, but you understand life (or think you do). Beg for food and coin.
- difficulty: easy
- leader: false
- multiple: true
- starting tag: Streetwise
- doc elements: townstarting

## Threats

Cult of Bacchus (Leader)
- Bacchus is the Lustful God, Creator of Illusions, the Eternal One. Bacchus is honest. Bacchus is life. Bacchus is pleasure. Bacchus is a zealot of hedonism. They rejoice over the fulfillment of desires and the euphoric suicide of their followers.
- You either love Bacchus and believe in their message, or love-hate them. Either way, you are certain you'll never leave.
- Bacchus is often depicted as an apple, a deer, or, in some circles, as a gigantic dead sea creature. Bacchus's gender is irrelevant. The specifics of doctrine are for you to figure out if you want.
- The stuck-ups in Ravenheart would kill you if they knew. Be careful.
- Followers of Bacchus gain +5 Tag Points per Desire instead of +3, but their Desires cannot be heroic or mild. They must, at least, be very indulgent. You also gain access to powerful Bacchus tags.
- Your goal is to spread the influence of Bacchus and throw parties. All cult members gain free Tags if you manage to host a party with 5, 10, or 15 people. People do not have to be part of the Cult to count towards the party number. Anyone with Royal Blood (Baron, Heir, Successor, Baroness, Bastard) counts as 3 people.
- There is a Succubus on the loose. She is an amazing asset, but she finds your ways too controlling. If you manage to bring her to the fold, she'll count as 3 people towards each party.
- Something very special happens if you host a party of 20 people. This is your ultimate goal. If the Succubus is present during the party, the surprise will be even better!
- You can either initiate people willingly or forcibly. Either way, you must perform a ritual that involves (1) either alcohol, music, lavish food, or drugs, and (2) secret chants in an ancient tongue.
- You can leave the Cult at any point, but you must confess everything you've ever done to a preacher, lose -10 Tag Points (yes, you can go into negative), and suffer through life-changing, excruciating withdrawal.
- difficulty: hard
- leader: true
- tag: leader
- multiple: false
- starting tag: Follower of Bacchus
- doc elements: townstarting

Cult of Bacchus (Cultist)
- Bacchus is the Lustful God, Creator of Illusions, the Eternal One. Bacchus is honest. Bacchus is life. Bacchus is pleasure. Bacchus is a zealot of hedonism. They rejoice over the fulfillment of desires and the euphoric suicide of their followers.
- You either love Bacchus and believe in their message, or love-hate them. Either way, you are certain you'll never leave.
- Bacchus is often depicted as an apple, a deer, or, in some circles, as a gigantic dead sea creature. Bacchus's gender is irrelevant. The specifics of doctrine are for you to figure out if you want.
- The stuck-ups in Ravenheart would kill you if they knew. Be careful.
- Followers of Bacchus gain +5 Tag Points per Desire instead of +3, but their Desires cannot be heroic or mild. They must, at least, be very indulgent. You also gain access to powerful Bacchus tags.
- You can either initiate people willingly or forcibly. Either way, you must perform a ritual that involves (1) either alcohol, music, lavish food, or drugs, and (2) secret chants in an ancient tongue.
- You can leave the Cult at any point, but you must confess everything you've ever done to a preacher, lose -10 Tag Points (yes, you can go into negative), and suffer through life-changing, excruciating withdrawal.
- difficulty: hard
- leader: false
- multiple: true
- starting tag: Follower of Bacchus
- doc elements: townstarting

The Judge (Town, or Cave)
- "Whatever in creation exists without my knowledge exists without my consent." You start with +15 Tag Points.
- True evil doesn't exist, but you come close. Among the lost, weak, and misunderstood, history contains those who inexplicably choose darkness. That is you.
- Your ultimate goal is to become infamous—not because you care what other people think, but because it sends a message. The more people know, fear, or respect your name, the better.
- Immortal or delusional, you treat life like a game. You glory in war and despise weakness. You fear nothing, although people that are genuinely good through and through make you uncomfortable. Fortunately, there are very few of those left.
- You can work alone, but you are a natural leader. Take over the Brigands, start an adventurer troop, or rise the ranks of the Bastard's entourage.
- Do not hide your nature or commit murders in the dark. People can't help but love you.
- Your Desires must relate to violence, glory, control, or competition.
- difficulty: hard
- leader: false
- multiple: false
- starting tag: Infamous
- doc elements: townstarting

--------

# Camp
- Fed and united, the Bastard's troop is a powerful entourage, capable of taking on Ravenheart. But they suffer from supply problems and inner conflict. To fund the war campaign: raid the village (might make you unpopular), loot the caves (dangerous), establish a small farm, or send people into town to build a reputation.
- The camp is split. During a feud, a man from the Broken Spears Clan killed a Wheeler. Execute the killer, punish the Lieutenant, or compensate the Wheelers with Food, before it spirals out of your control.

## Roles

### Faction: The Bastard's Camp
Bastard (Windrider Clan)
- You've finally returned to your ancestral home. Unite your Lieutenants, feed your men, and take Ravenheart—it's your people's only hope.
- The Bastard and his men wear wind goggles and capes and generally aura farm. It's a wasteland out there. Most of your people are herders, healers, and engineers.
- difficulty: hard
- leader: true
- tag: leader
- multiple: false
- starting tag: Royal Blood
- doc elements: campstarting

Camp Followers
- Tend wounds, keep the camp, keep the herds.
- difficulty: easy
- leader: false
- multiple: true
- starting tag: Resilient
- doc elements: campstarting

Mother
- Counsel and support your son, spy on the Lieutenants and ensure their loyalty. You would die for him.
- difficulty: normal
- leader: false
- multiple: false
- starting tag: Watchful
- doc elements: campstarting

Champion
- You taught the Bastard how to fight, how to sing, how to survive. You will follow him to death.
- difficulty: normal
- leader: false
- multiple: false
- starting tag: Battle-Hardened
- doc elements: campstarting

Mentat
- The Bastard's right-hand man, in charge of ensuring—across clan lines—that there's enough Food and it's being equally split. He is the spymaster, the genius, the engineer, the calculator.
- difficulty: normal
- leader: false
- multiple: false
- starting tag: Sharp Mind
- doc elements: campstarting

Lieutenant (Broken Spears Clan)
- Your men are hungry. What is all this kingmaking business? Just attack the fortress, raid the village! You trust the Bastard, but he doesn't act fast enough. Stimulant users.
- You are feuding with the Wheelers.
- Members: Fighter, Fighter (Builder), Fighter (Standard Bearer), Fighter (Etc.), Camp Follower.
- difficulty: normal
- leader: true
- tag: leader
- multiple: false
- starting tag: Stimulant User
- doc elements: campstarting

Lieutenant (Six-Spoke Wheel Clan)
- Famed for their mastery over the revolver. The Six-Spoke Wheel Clan are ancient herders and lawkeepers—the old guard. Defend your honor. You trust the Bastard, but he doesn't respect the old ways enough.
- You are feuding with the Broken Spears.
- Members: Fighter, Fighter (Tinker), Fighter (Standard Bearer), etc., Camp Follower.
- difficulty: normal
- leader: true
- tag: leader
- multiple: false
- starting tag: Old Guard
- doc elements: campstarting

Lieutenant (Windrider Clan)
- All you want is a home for your people, and the Bastard can provide you that. You're fully loyal to him.
- difficulty: normal
- leader: true
- tag: leader
- multiple: false
- starting tag: Loyal
- doc elements: campstarting

## Threats

Brigand Leader
- You raided a shipment on the way to the Fortress—well done! You have plenty of Food, now.
- difficulty: normal
- leader: true
- tag: leader
- multiple: false
- starting tag: Opportunist
- doc elements: campstarting

Brigand
- You raided a shipment on the way to the Fortress—well done! You have plenty of Food, now.
- difficulty: normal
- leader: false
- multiple: true
- starting tag: Opportunist
- doc elements: campstarting

--------

# Caves
- The Caves: Migrants make it to the Fortress from here.

## Roles

### Faction: Caves
Migrant
- Make it to the fortress.
- difficulty: easy
- leader: false
- multiple: true
- starting tag: Determined
- doc elements:

Mercenary
- Delve into the Caves for pay.
- difficulty: normal
- leader: false
- multiple: true
- starting tag: Battle-Hardened
- doc elements:

Miner
- Work the Caves.
- difficulty: easy
- leader: false
- multiple: true
- starting tag: Sturdy
- doc elements:

## Threats

Monsters (NPC)
- Monsters in the caves, to be hunted.
- difficulty: hard
- leader: false
- multiple: true
- starting tag:
- doc elements:

Brigand Leader (Caves)
- Loot the caves (dangerous) as a way to fund the Camp's war effort.
- difficulty: normal
- leader: true
- tag: leader
- multiple: false
- starting tag: Opportunist
- doc elements:

Brigand (Caves)
- Loot the caves (dangerous) as a way to fund the Camp's war effort.
- difficulty: normal
- leader: false
- multiple: true
- starting tag: Opportunist
- doc elements:

--------

# Documents


Courtier
As a member of the Baron’s retinue, you may take food from the faction Silo whenever you please—within reason.

Diplomat
You are from the Culture, a post-scarcity interstellar empire ruled by benevolent robots. You want the best for the people of Ravenheart—and that would mean convincing the Baron to join the Culture—but Contact (the Culture's diplomatic wing) operates in the scale of centuries, not human generations. They don't think it's the right time. Therefore, do the best you can to quietly help people and further the Culture's mission: install an open-minded ruler, ensure the Order of the Iron Cross doesn't grow out of control, and above all, do not blow your cover. You have limited gadgets—including an autonomous, sentient drone disguised as a raven. If anything goes wrong, the "Helpless Is The Face Of Your Beauty" will teleport you on board. It'll take your message three minutes to reach them.