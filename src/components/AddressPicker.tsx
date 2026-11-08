import { useEffect, useMemo, useState } from 'react';
import provinceData from 'phil-reg-prov-mun-brgy/src/json/provinces.json';
import cityMunData from 'phil-reg-prov-mun-brgy/src/json/city-mun.json';
import './AddressPicker.css';

type Province = { name: string; reg_code: string; prov_code: string };
type CityMun = { name: string; prov_code: string; mun_code: string };
type Barangay = { name: string; mun_code: string };

export type AddressValue = {
  province: string;
  city: string;
  barangay: string;
};

type AddressPickerProps = {
  value: AddressValue;
  onChange: (value: AddressValue) => void;
};

const provinces = (provinceData as Province[])
  .slice()
  .sort((a, b) => a.name.localeCompare(b.name));

const citiesByProvince = (cityMunData as CityMun[]).reduce<Record<string, CityMun[]>>(
  (map, city) => {
    (map[city.prov_code] ||= []).push(city);
    return map;
  },
  {}
);

/** Title case, because the dataset stores provinces in upper case. */
const titleCase = (value: string) =>
  value
    .toLowerCase()
    .replace(/(^|[\s(\-/])([a-z])/g, (_, prefix: string, letter: string) => prefix + letter.toUpperCase());

/**
 * Province, city or municipality, and barangay pickers for a Philippine address.
 *
 * The barangay list is 1.7 MB, so it is loaded on demand the first time a city is
 * chosen rather than shipped in the initial bundle. Provinces and cities together
 * are about 100 KB and load with the page.
 */
const AddressPicker: React.FC<AddressPickerProps> = ({ value, onChange }) => {
  const [provinceCode, setProvinceCode] = useState('');
  const [cityCode, setCityCode] = useState('');
  const [barangays, setBarangays] = useState<Barangay[]>([]);
  const [loadingBarangays, setLoadingBarangays] = useState(false);

  const cities = useMemo(() => {
    const list = citiesByProvince[provinceCode] ?? [];
    return list.slice().sort((a, b) => a.name.localeCompare(b.name));
  }, [provinceCode]);

  useEffect(() => {
    if (!cityCode) {
      setBarangays([]);
      return;
    }

    let active = true;
    setLoadingBarangays(true);

    import('phil-reg-prov-mun-brgy/src/json/barangays.json')
      .then((module) => {
        if (!active) return;

        const all = (module.default ?? module) as Barangay[];
        setBarangays(
          all
            .filter((barangay) => barangay.mun_code === cityCode)
            .sort((a, b) => a.name.localeCompare(b.name))
        );
      })
      .finally(() => {
        if (active) setLoadingBarangays(false);
      });

    return () => {
      active = false;
    };
  }, [cityCode]);

  const handleProvince = (code: string) => {
    setProvinceCode(code);
    setCityCode('');
    onChange({
      province: titleCase(provinces.find((p) => p.prov_code === code)?.name ?? ''),
      city: '',
      barangay: '',
    });
  };

  const handleCity = (code: string) => {
    setCityCode(code);
    onChange({
      ...value,
      city: titleCase(cities.find((c) => c.mun_code === code)?.name ?? ''),
      barangay: '',
    });
  };

  const handleBarangay = (name: string) => {
    onChange({ ...value, barangay: name });
  };

  return (
    <div className="address-picker">
      <div className="address-picker__field">
        <label htmlFor="address-province">Province</label>
        <select
          id="address-province"
          className="address-picker__select"
          value={provinceCode}
          onChange={(event) => handleProvince(event.target.value)}
        >
          <option value="">Select province</option>
          {provinces.map((province) => (
            <option key={province.prov_code} value={province.prov_code}>
              {titleCase(province.name)}
            </option>
          ))}
        </select>
      </div>

      <div className="address-picker__field">
        <label htmlFor="address-city">City / Municipality</label>
        <select
          id="address-city"
          className="address-picker__select"
          value={cityCode}
          disabled={!provinceCode}
          onChange={(event) => handleCity(event.target.value)}
        >
          <option value="">
            {provinceCode ? 'Select city or municipality' : 'Select a province first'}
          </option>
          {cities.map((city) => (
            <option key={city.mun_code} value={city.mun_code}>
              {titleCase(city.name)}
            </option>
          ))}
        </select>
      </div>

      <div className="address-picker__field">
        <label htmlFor="address-barangay">Barangay</label>
        <select
          id="address-barangay"
          className="address-picker__select"
          value={value.barangay}
          disabled={!cityCode || loadingBarangays}
          onChange={(event) => handleBarangay(event.target.value)}
        >
          <option value="">
            {!cityCode
              ? 'Select a city or municipality first'
              : loadingBarangays
                ? 'Loading barangays...'
                : 'Select barangay'}
          </option>
          {barangays.map((barangay) => (
            <option key={`${barangay.mun_code}-${barangay.name}`} value={barangay.name}>
              {barangay.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};

export default AddressPicker;
