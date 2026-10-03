export interface PlaceConfigItem {
  id: string;
  title: string;
  subtitle: string;
  lat: number;
  lng: number;
  googlePlaceId?: string;
  imageUrl?: string | null;
  photoName?: string | null;
  photoAttribution?: string | null;
}

export interface PlacesConfig {
  quickPicks: PlaceConfigItem[];
  popular: PlaceConfigItem[];
  cityHighlights: PlaceConfigItem[];
}

/**
 * Curated Salem places for the rider Home screen.
 *
 * imageUrl: a direct photo the app can always load (Wikimedia Commons,
 * verified live). This is the guaranteed fallback so place cards are never
 * blank. When GOOGLE_PLACES_API_KEY is configured on the backend, Google
 * Places photos are resolved at runtime and served via /places/photo/:id,
 * taking precedence over these URLs (see buildImageUrl in places.service).
 */
export const PLACES_CONFIG: PlacesConfig = {
  quickPicks: [
    {
      id: 'qp-bus',
      title: 'Salem New Bus Stand',
      subtitle: 'Ammapet, Salem',
      lat: 11.6625,
      lng: 78.1473,
      googlePlaceId: 'ChIJjQkU_X3uqzsRgL7hJ3V6_xM',
      imageUrl:
        'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a6/An_image_of_Bharat_Ratna_Dr_MGR_Central_Bus_Stand%2C_Salem_Corporation.JPG/960px-An_image_of_Bharat_Ratna_Dr_MGR_Central_Bus_Stand%2C_Salem_Corporation.JPG',
      photoAttribution: 'Wikimedia Commons',
    },
    {
      id: 'qp-rly',
      title: 'Salem Junction',
      subtitle: 'Station Road, Salem',
      lat: 11.658,
      lng: 78.1613,
      googlePlaceId: 'ChIJ_z_m-2LuqzsR6l1d0wQYgAc',
      imageUrl:
        'https://thumb.wikimedia.org/wikipedia/commons/thumb/7/77/Salem_Junction_railway_station.jpg/960px-Salem_Junction_railway_station.jpg',
      photoAttribution: 'Wikimedia Commons',
    },
    {
      id: 'qp-sona',
      title: 'Sona College',
      subtitle: 'Sona Nagar, Salem',
      lat: 11.6768,
      lng: 78.095,
      googlePlaceId: 'ChIJ0V019dHuqzsRw6yN9sV8o_0',
      // No freely licensed campus photo found. Google Places fills this one
      // in when GOOGLE_PLACES_API_KEY is set; until then this single tile
      // shows the app's standard placeholder.
      imageUrl: null,
      photoAttribution: null,
    },
  ],
  popular: [
    {
      id: 'pop-hospital',
      title: 'Govt. Mohan Kumaramangalam Medical College',
      subtitle: 'Maravaneri, Salem',
      lat: 11.6673,
      lng: 78.1416,
      googlePlaceId: 'ChIJ7_z_m-2LuqzsR-hospital1',
      imageUrl:
        'https://thumb.wikimedia.org/wikipedia/commons/thumb/3/3f/Gmkmc-aerial-view.jpg/960px-Gmkmc-aerial-view.jpg',
      photoAttribution: 'Wikimedia Commons',
    },
    {
      id: 'pop-kottai',
      title: 'Kottai Mariamman Temple',
      subtitle: 'Shevapet, Salem',
      lat: 11.6647,
      lng: 78.1531,
      googlePlaceId: 'ChIJ-kottai-temple-salem',
      imageUrl:
        'https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d1/KOTTAI_MARIAMMAN_TEMPLE%2C_SALEM_-_panoramio_%2814%29.jpg/960px-KOTTAI_MARIAMMAN_TEMPLE%2C_SALEM_-_panoramio_%2814%29.jpg',
      photoAttribution: 'Wikimedia Commons',
    },
    {
      id: 'pop-steel',
      title: 'Salem Steel Plant',
      subtitle: 'Kanjamalai, Salem',
      lat: 11.7094,
      lng: 78.0614,
      googlePlaceId: 'ChIJ-steel-plant-salem',
      imageUrl:
        'https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b4/A_photo_of_Salem_Steel_Plant_entrance.JPG/960px-A_photo_of_Salem_Steel_Plant_entrance.JPG',
      photoAttribution: 'Wikimedia Commons',
    },
  ],
  cityHighlights: [
    {
      id: 'hl-yercaud',
      title: 'Yercaud Lake',
      subtitle: 'Yercaud Hills, Salem District',
      lat: 11.775,
      lng: 78.2072,
      googlePlaceId: 'ChIJ-yercaud-lake',
      imageUrl:
        'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f7/Yercaud_lake_view.jpg/960px-Yercaud_lake_view.jpg',
      photoAttribution: 'Wikimedia Commons',
    },
    {
      id: 'hl-mettur',
      title: 'Mettur Dam',
      subtitle: 'Mettur, Salem District',
      lat: 11.7851,
      lng: 77.8003,
      googlePlaceId: 'ChIJ-mettur-dam',
      imageUrl:
        'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f4/Mettur_dam.jpg/960px-Mettur_dam.jpg',
      photoAttribution: 'Wikimedia Commons',
    },
    {
      id: 'hl-lingam',
      title: '1008 Lingam Temple',
      subtitle: 'Ariyanoor, Salem',
      lat: 11.6033,
      lng: 78.0672,
      googlePlaceId: 'ChIJ-1008-lingam-temple',
      imageUrl:
        'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/1a/1008_Shiva_%26_Rajarajeshwari_Temple_Salem.jpg/960px-1008_Shiva_%26_Rajarajeshwari_Temple_Salem.jpg',
      photoAttribution: 'Wikimedia Commons',
    },
  ],
};
