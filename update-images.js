const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const db = new sqlite3.Database(path.join(__dirname, 'pokecard.db'));

db.serialize(() => {
  db.run(
    "UPDATE cards SET image_url = ? WHERE id = ?",
    ['https://www.pokemon-card.com/assets/images/card_images/large/SV11W/048051_P_DASUTODASU.jpg', 'TC_SV11WF_139_086'],
    (err) => {
      if (err) console.error('TC Update err:', err);
      else console.log('Successfully updated TC_SV11WF_139_086 image!');
    }
  );

  db.run(
    "UPDATE cards SET image_url = ? WHERE id = ?",
    ['https://www.pokemon-card.com/assets/images/card_images/large/M2/048489_P_KARUBOU.jpg', 'JP_M2_083_080'],
    (err) => {
      if (err) console.error('JP Update err:', err);
      else console.log('Successfully updated JP_M2_083_080 image!');
    }
  );
});

db.close();
