-- Seed: migrate 2025 route/street data from the Google Sheet
-- (historical/reference data; 2026 dates to be entered via the admin UI once confirmed)

-- Routes
INSERT INTO routes (name, display_order) VALUES ('Route 1', 1)
  ON CONFLICT (name) DO NOTHING;
INSERT INTO routes (name, display_order) VALUES ('Route 2', 2)
  ON CONFLICT (name) DO NOTHING;
INSERT INTO routes (name, display_order) VALUES ('Route 3', 3)
  ON CONFLICT (name) DO NOTHING;
INSERT INTO routes (name, display_order) VALUES ('Route 4', 4)
  ON CONFLICT (name) DO NOTHING;
INSERT INTO routes (name, display_order) VALUES ('Route 5', 5)
  ON CONFLICT (name) DO NOTHING;
INSERT INTO routes (name, display_order) VALUES ('Route 6', 6)
  ON CONFLICT (name) DO NOTHING;
INSERT INTO routes (name, display_order) VALUES ('Route 9', 9)
  ON CONFLICT (name) DO NOTHING;
INSERT INTO routes (name, display_order) VALUES ('Route 8', 8)
  ON CONFLICT (name) DO NOTHING;
INSERT INTO routes (name, display_order) VALUES ('Route 7', 7)
  ON CONFLICT (name) DO NOTHING;
INSERT INTO routes (name, display_order) VALUES ('Route 10', 10)
  ON CONFLICT (name) DO NOTHING;

-- Route dates + streets
DO $$
DECLARE
  v_route_id INTEGER;
  v_route_date_id INTEGER;
BEGIN
  SELECT id INTO v_route_id FROM routes WHERE name = 'Route 1';
  INSERT INTO route_dates (route_id, event_date) VALUES (v_route_id, '2025-12-01')
    ON CONFLICT (route_id, event_date) DO UPDATE SET route_id = EXCLUDED.route_id
    RETURNING id INTO v_route_date_id;
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 1, 'Sunningdale Drive', '1800-1830');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 2, 'Welwyn Drive (Partial)', '1800-1830');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 3, 'Branksome Drive', '1800-1830');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 4, 'Welwyn Drive (Partial)', '1830-1900');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 5, 'Runnymeade (Partial)', '1830-1900');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 6, 'Magna Carta Court (entrance)', '1900-1930');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 7, 'Parkstone Drive (Entrance)', '1900-1930');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 8, 'Cliftonville Drive', '1900-1930');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 9, 'Cranford Close (Entrance)', '1930-2000');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 10, 'Torrax Close (Entrance)', '1930-2000');
END $$;

DO $$
DECLARE
  v_route_id INTEGER;
  v_route_date_id INTEGER;
BEGIN
  SELECT id INTO v_route_id FROM routes WHERE name = 'Route 2';
  INSERT INTO route_dates (route_id, event_date) VALUES (v_route_id, '2025-12-11')
    ON CONFLICT (route_id, event_date) DO UPDATE SET route_id = EXCLUDED.route_id
    RETURNING id INTO v_route_date_id;
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 1, 'Delamere Avenue', '1800-1830');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 2, 'Swinton Park Rd (Partial)', '1800-1830');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 3, 'Overlinks Drive', '1830-1900');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 4, 'Radcliffe Park Road (Partial)', '1830-1900');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 5, 'Avondale Drive', '1830-1900');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 6, 'Oakwood Drive', '1900-1930');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 7, 'Radcliffe Park Road (Partial)', '1900-1930');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 8, 'Weylands Grove', '1930-2000');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 9, 'Radcliffe Park Road (Partial)', '1930-2000');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 10, 'Radcliffe Park Crescent (Entrance)', '2000-2015');
END $$;

DO $$
DECLARE
  v_route_id INTEGER;
  v_route_date_id INTEGER;
BEGIN
  SELECT id INTO v_route_id FROM routes WHERE name = 'Route 3';
  INSERT INTO route_dates (route_id, event_date) VALUES (v_route_id, '2025-12-04')
    ON CONFLICT (route_id, event_date) DO UPDATE SET route_id = EXCLUDED.route_id
    RETURNING id INTO v_route_date_id;
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 1, 'Park Lane (Partial)', '1800-1815');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 2, 'Stapleton Street', '1800-1815');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 3, 'Claremont Road (Partial)', '1815-1830');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 4, 'New Barton Street', '1815-1830');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 5, 'Park Lane (Partial)', '1830-1845');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 6, 'Saxby Street (Partial)', '1830-1845');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 7, 'Helena Street', '1830-1845');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 8, 'Park Lane (Partial)', '1845-1900');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 9, 'New Herbert Street', '1845-1900');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 10, 'Saxby Street (Partial)', '1845-1900');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 11, 'Claremont Road (Partial)', '1900-1915');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 12, 'Ashbourne Road', '1915-1930');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 13, 'Kendal Road (Partial)', '1930-1945');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 14, 'Rudyard Road', '1930-1945');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 15, 'Claremont Road (Partial)', '1945-2000');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 16, 'Longton Road', '1945-2000');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 17, 'Kendal Road (Partial)', '2000-2015');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 18, 'Godfrey Road', '2000-2015');
END $$;

DO $$
DECLARE
  v_route_id INTEGER;
  v_route_date_id INTEGER;
BEGIN
  SELECT id INTO v_route_id FROM routes WHERE name = 'Route 4';
  INSERT INTO route_dates (route_id, event_date) VALUES (v_route_id, '2025-12-02')
    ON CONFLICT (route_id, event_date) DO UPDATE SET route_id = EXCLUDED.route_id
    RETURNING id INTO v_route_date_id;
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 1, 'Lullington Road (Partial)', '1800-1815');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 2, 'Buckland Road', '1800-1815');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 3, 'Lullington Road (Partial)', '1800-1815');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 4, 'Manor Road (Partial)', '1815-1830');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 5, 'Doveleys Road (Partial)', '1815-1830');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 6, 'Caldy Road (Partial)', '1815-1830');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 7, 'Dronfield Road (Partial)', '1830-1845');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 8, 'Longmead Road', '1830-1845');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 9, 'Moorfield Road (Partial)', '1830-1845');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 10, 'Trenant Road', '1845-1900');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 11, 'Dronfield Road (Partial)', '1845-1900');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 12, 'Denstone Road', '1845-1900');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 13, 'Churchfield Road', '1900-1915');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 14, 'Elleray Road', '1900-1915');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 15, 'King Street (Partial)', '1900-1915');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 16, 'Duffield Road', '1915-1930');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 17, 'Acresfield Road (Partial)', '1915-1930');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 18, 'Alresford Road', '1930-1945');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 19, 'Penelope Road (Alresford crossroad)', '1930-1945');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 20, 'Hunts Road', '1945-2000');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 21, 'Sumner Road', '1945-2000');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 22, 'Moorfield Road (Partial)', '1900-2015');
END $$;

DO $$
DECLARE
  v_route_id INTEGER;
  v_route_date_id INTEGER;
BEGIN
  SELECT id INTO v_route_id FROM routes WHERE name = 'Route 5';
  INSERT INTO route_dates (route_id, event_date) VALUES (v_route_id, '2025-12-03')
    ON CONFLICT (route_id, event_date) DO UPDATE SET route_id = EXCLUDED.route_id
    RETURNING id INTO v_route_date_id;
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 1, 'Burnside Avenue', '1800-1815');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 2, 'Russell Road (Partial)', '1800-1815');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 3, 'Westgate Road (Partial)', '1815-1830');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 4, 'Hallwood Avenue', '1815-1830');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 5, 'Moorville Road (Partial)', '1815-1830');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 6, 'Margrove Road', '1830-1845');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 7, 'Westgate Road (Partial)', '1830-1845');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 8, 'Light Oaks Road (Partial)', '1830-1845');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 9, 'Claremont Road (Partial)', '1845-1900');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 10, 'Chamlea Manor (Chomlea Manor)', '1845-1900');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 11, 'Cholmondeley Road  (Partial)', '1900-1915');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 12, 'Winchester Road (Cholmondeley crossroad)', '1900-1915');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 13, 'Guildford Road (Cholmondeley Rd crossroads)', '1915-1930');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 14, 'Cholmondeley Road  (Partial)', '1915-1930');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 15, 'Hayfield Road', '1930-1945');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 16, 'Winchester Road (Partial)', '1930-1945');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 17, 'Light Oaks Road (Partial)', '1945-2000');
END $$;

DO $$
DECLARE
  v_route_id INTEGER;
  v_route_date_id INTEGER;
BEGIN
  SELECT id INTO v_route_id FROM routes WHERE name = 'Route 6';
  INSERT INTO route_dates (route_id, event_date) VALUES (v_route_id, '2025-12-08')
    ON CONFLICT (route_id, event_date) DO UPDATE SET route_id = EXCLUDED.route_id
    RETURNING id INTO v_route_date_id;
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 1, 'Orme Avenue', '1800-1815');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 2, 'Oxford Road (Partial)', '1800-1815');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 3, 'Odessa Avenue', '1800-1815');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 4, 'Orient Road (Partial)', '1815-1830');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 5, 'Ormonde Avenue (Partial)', '1815-1830');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 6, 'Oxford Road (Partial)', '1815-1830');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 7, 'Otranto Avenue', '1815-1830');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 8, 'Orient Road (Partial)', '1830-1845');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 9, 'Orama Avenue', '1830-1845');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 10, 'Oxford Road (Partial)', '1830-1845');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 11, 'Victoria Road (Partial)', '1845-1900');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 12, 'Orvietto Avenue', '1845-1900');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 13, 'Wilton Road (Partial)', '1845-1900');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 14, 'Oakland Avenue', '1900-1915');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 15, 'Victoria Road (Partial)', '1900-1915');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 16, 'Orlanda Avenue', '1900-1915');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 17, 'Wilton Road (Partial)', '1915-1930');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 18, 'Hawthorn Drive', '1915-1930');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 19, 'Wilton Road (Partial)', '1915-1930');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 20, 'Vandyke Avenue', '1930-1945');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 21, 'Acacia Drive', '1930-1945');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 22, 'Wilton Road (Partial)', '1930-1945');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 23, 'Vauban Drive', '1930-1945');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 24, 'Wilton Road (Partial)', '1945-2000');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 25, 'Verdun Avenue', '1945-2000');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 26, 'Vestris Drive (Partial)', '1945-2000');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 27, 'Voltaire Avenue', '2000-2015');
END $$;

DO $$
DECLARE
  v_route_id INTEGER;
  v_route_date_id INTEGER;
BEGIN
  SELECT id INTO v_route_id FROM routes WHERE name = 'Route 9';
  INSERT INTO route_dates (route_id, event_date) VALUES (v_route_id, '2025-12-09')
    ON CONFLICT (route_id, event_date) DO UPDATE SET route_id = EXCLUDED.route_id
    RETURNING id INTO v_route_date_id;
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 1, 'West Drive', '1800-1815');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 2, 'North Drive (Partial)', '1800-1815');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 3, 'W Central Drive', '1815-1830');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 4, 'E Central Drive', '1815-1830');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 5, 'North Drive (Partial)', '1830-1845');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 6, 'East Drive', '1830-1845');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 7, 'Pontefract Close (Entrance)', '1845-1900');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 8, 'May Road (Partial)', '1900-1915');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 9, 'Blantyre Road (Partial)', '1900-1915');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 10, 'Hospital Road (Partial)', '1915-1930');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 11, 'Holdren Drive (North end, Partial)', '1915-1930');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 12, 'Sillavan Close', '1930-1945');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 13, 'Holden Drive (Partial)', '1930-1945');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 14, 'Wrigley Avenue', '1945-2000');
END $$;

DO $$
DECLARE
  v_route_id INTEGER;
  v_route_date_id INTEGER;
BEGIN
  SELECT id INTO v_route_id FROM routes WHERE name = 'Route 8';
  INSERT INTO route_dates (route_id, event_date) VALUES (v_route_id, '2025-12-10')
    ON CONFLICT (route_id, event_date) DO UPDATE SET route_id = EXCLUDED.route_id
    RETURNING id INTO v_route_date_id;
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 1, 'Rothesay Road (Partial)', '1800-1815');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 2, 'Osborne Drive (Partial)', '1800-1815');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 3, 'Ranelagh Road (Partial)', '1815-1830');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 4, 'Osborne Drive (Partial)', '1830-1845');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 5, 'Hawthorn Drive', '1830-1845');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 6, 'Ranelagh Road (Partial)', '1830-1845');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 7, 'Hospital Road (Partial)', '1845-1900');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 8, 'High Bank Road', '1900-1915');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 9, 'Sherwood Drive (Entrance)', '1900-1915');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 10, 'Goodwood Drive (Entrance)', '1915-1930');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 11, 'Birch Drive', '1930-1945');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 12, 'Hospital Road (Partial)', '1945-2000');
END $$;

DO $$
DECLARE
  v_route_id INTEGER;
  v_route_date_id INTEGER;
BEGIN
  SELECT id INTO v_route_id FROM routes WHERE name = 'Route 7';
  INSERT INTO route_dates (route_id, event_date) VALUES (v_route_id, '2025-12-12')
    ON CONFLICT (route_id, event_date) DO UPDATE SET route_id = EXCLUDED.route_id
    RETURNING id INTO v_route_date_id;
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 1, 'St John St (Partial)', '1800-1815');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 2, 'Hillside Drive (Entrance)', '1800-1815');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 3, 'Houghton St (entrance)', '1800-1815');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 4, 'Broomhall Road (Partial)', '1815-1830');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 5, 'Broomfield (entrance)', '1830-1845');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 6, 'Fairway', '1900-1915');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 7, 'Highfield Drive (Partial)', '1900-1915');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 8, 'Waverley Road (east of Highfield)', '1915-1930');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 9, 'Beverley Road (east of Highfield)', '1915-1930');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 10, 'Highfield Drive (Partial)', '1915-1930');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 11, 'Shirley Avenue (east of Highfield)', '1930-1945');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 12, 'Westwood Drive (Partial)', '1930-1945');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 13, 'Kingsway (Partial)', '1945-2000');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 14, 'Parksway (Partial)', '1945-2000');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 15, 'St Austell''s Drive', '2000-2015');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 16, 'Parksway (Partial)', '2000-2015');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 17, 'Danesway (Partial)', '2000-2015');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 18, 'Wilton Avenue (Entrance)', '2015-2030');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 19, 'Danesway (Partial)', '2015-2030');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 20, 'Highfield Drive (Partial)', '2015-2030');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 21, 'Kingsway (Partial)', '2030-2045');
END $$;

DO $$
DECLARE
  v_route_id INTEGER;
  v_route_date_id INTEGER;
BEGIN
  SELECT id INTO v_route_id FROM routes WHERE name = 'Route 10';
  INSERT INTO route_dates (route_id, event_date) VALUES (v_route_id, '2025-12-05')
    ON CONFLICT (route_id, event_date) DO UPDATE SET route_id = EXCLUDED.route_id
    RETURNING id INTO v_route_date_id;
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 1, 'Kilcoby Avenue (Partial)', '1800-1815');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 2, 'Bolbury Crescent (Partial)', '1800-1815');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 3, 'Wet Earth Green (Partial)', '1815-1830');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 4, 'Kilcoby Avenue (Partial)', '1830-1845');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 5, 'Agecroft Road (Partial)', '1845-1900');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 6, 'Dauntesy Avenue', '1900-1915');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 7, 'Dalton Drive', '1915-1930');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 8, 'Deepdale Drive', '1930-1945');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 9, 'Dell Avenue (Partial)', '1945-2000');
  INSERT INTO streets (route_date_id, sequence, name, time_range) VALUES (v_route_date_id, 10, 'Park Lane West', '1945-2000');
END $$;
