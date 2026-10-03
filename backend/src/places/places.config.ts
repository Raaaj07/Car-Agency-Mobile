export interface PlaceConfigItem {
  id: string;
  title: string;
  subtitle: string;
  lat: number;
  lng: number;
  googlePlaceId?: string;
  imageUrl?: string | null;
  photoAttribution?: string | null;
}

export interface PlacesConfig {
  quickPicks: PlaceConfigItem[];
  popular: PlaceConfigItem[];
  cityHighlights: PlaceConfigItem[];
}

export const PLACES_CONFIG: PlacesConfig = {
  quickPicks: [
    { id: 'qp-bus', title: 'Salem New Bus Stand', subtitle: 'Ammapet, Salem', lat: 11.6625, lng: 78.1473, googlePlaceId: 'ChIJjQkU_X3uqzsRgL7hJ3V6_xM' },
    { id: 'qp-rly', title: 'Salem Junction', subtitle: 'Station Road, Salem', lat: 11.6580, lng: 78.1613, googlePlaceId: 'ChIJ_z_m-2LuqzsR6l1d0wQYgAc' },
    { id: 'qp-sona', title: 'Sona College', subtitle: 'Sona Nagar, Salem', lat: 11.6768, lng: 78.0950, googlePlaceId: 'ChIJ0V019dHuqzsRw6yN9sV8o_0' },
  ],
  popular: [
    { id: 'pop-hospital', title: 'Govt. Mohan Kumaramangalam Medical College', subtitle: 'Maravaneri, Salem', lat: 11.6673, lng: 78.1416, googlePlaceId: 'ChIJ7_z_m-2LuqzsR-hospital1' },
    { id: 'pop-kottai', title: 'Kottai Mariamman Temple', subtitle: 'Shevapet, Salem', lat: 11.6647, lng: 78.1531, googlePlaceId: 'ChIJ-kottai-temple-salem' },
    { id: 'pop-steel', title: 'Salem Steel Plant', subtitle: 'Kanjamalai, Salem', lat: 11.7094, lng: 78.0614, googlePlaceId: 'ChIJ-steel-plant-salem' },
  ],
  cityHighlights: [
    { id: 'hl-yercaud', title: 'Yercaud Lake', subtitle: 'Yercaud Hills, Salem District', lat: 11.7750, lng: 78.2072, googlePlaceId: 'ChIJ-yercaud-lake' },
    { id: 'hl-mettur', title: 'Mettur Dam', subtitle: 'Mettur, Salem District', lat: 11.7851, lng: 77.8003, googlePlaceId: 'ChIJ-mettur-dam' },
    { id: 'hl-lingam', title: '1008 Lingam Temple', subtitle: 'Ariyanoor, Salem', lat: 11.6033, lng: 78.0672, googlePlaceId: 'ChIJ-1008-lingam-temple' },
  ],
};
